import { z } from "zod";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { defined, id, optionalText, patchMarkdown, patchText, text } from "../domain/sanitize.js";
import { ENUMS, LIMITS } from "../limits.js";
import { defineTool } from "../mcp/tool.js";
import { ownedParent } from "./evaluations.js";
import { nextPosition } from "./ownership.js";

const confirm = z.literal(true).describe("Debe ser true: la persona confirmó esta acción irreversible");

async function questionExam(
	db: Parameters<typeof ownedParent>[0],
	actor: Parameters<typeof ownedParent>[1],
	classroomId: string,
	questionId: string
) {
	const { data } = await db.from("exam_questions").select("exam_id").eq("id", questionId).maybeSingle();
	const examId = (data as { exam_id: string } | null)?.exam_id;
	if (!examId) throw new ToolError(NOT_FOUND);
	return { examId, ...(await ownedParent(db, actor, classroomId, "exams", examId)) };
}

async function criterionScenario(
	db: Parameters<typeof ownedParent>[0],
	actor: Parameters<typeof ownedParent>[1],
	classroomId: string,
	criterionId: string
) {
	const { data } = await db.from("scenario_criteria").select("scenario_id").eq("id", criterionId).maybeSingle();
	const scenarioId = (data as { scenario_id: string } | null)?.scenario_id;
	if (!scenarioId) throw new ToolError(NOT_FOUND);
	return { scenarioId, ...(await ownedParent(db, actor, classroomId, "scenarios", scenarioId)) };
}

async function lessonInModule(db: Parameters<typeof ownedParent>[0], moduleId: string, sessionId: string | undefined) {
	if (!sessionId) return null;
	const { data } = await db.from("sessions").select("id").eq("id", sessionId).eq("module_id", moduleId).maybeSingle();
	if (!data) throw new ToolError("Elige una lección de este módulo.");
	return sessionId;
}

export const getExam = defineTool({
	name: "get_exam",
	title: "Detalle del examen",
	description: "Devuelve la configuración de un simulacro o examen y todas sus preguntas con sus IDs.",
	level: "team",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula"), exam_id: id("Examen") }),
	async run({ db, actor }, input) {
		await ownedParent(db, actor, input.classroom_id, "exams", input.exam_id);
		const [{ data: exam }, { data: questions }] = await Promise.all([
			db.from("exams").select("*").eq("id", input.exam_id).maybeSingle(),
			db
				.from("exam_questions")
				.select("id, prompt, options, correct_index, explanation, topic, session_id, position")
				.eq("exam_id", input.exam_id)
				.order("position")
		]);
		if (!exam) throw new ToolError(NOT_FOUND);
		return {
			exam,
			questions: ((questions ?? []) as { id: string; correct_index: number }[]).map(({ id: questionId, correct_index, ...rest }) => ({
				question_id: questionId,
				correct: correct_index + 1,
				...rest
			}))
		};
	}
});

export const updateExam = defineTool({
	name: "update_exam",
	title: "Editar examen",
	description:
		"Cambia la configuración de un simulacro o examen. Solo se modifica lo que envíes. Confirma con la persona antes de publicar. Para activar el simulacro el examen necesita al menos 10 preguntas.",
	level: "team",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		exam_id: id("Examen"),
		title: z
			.string()
			.optional()
			.transform((value) => (value === undefined ? undefined : value.trim().slice(0, 160)))
			.pipe(z.string().min(1).optional()),
		description: patchMarkdown(4000, "Instrucciones"),
		published: z.boolean().optional(),
		repeatable: z.boolean().optional().describe("Si se puede repetir cada cierto tiempo"),
		repeat_days: z.number().int().min(0).max(365).optional(),
		repeat_hours: z.number().int().min(0).max(8760).optional(),
		max_attempts: z.number().int().min(1).max(50).optional(),
		pass_percent: z.number().int().min(1).max(100).optional(),
		time_limit_minutes: z.number().int().min(0).max(600).optional().describe("0 quita el límite"),
		review_mode: z.enum(ENUMS.reviewMode).optional(),
		feedback_pass: patchText(600, "Mensaje si aprueba"),
		feedback_fail: patchText(600, "Mensaje si no aprueba"),
		practice_enabled: z.boolean().optional(),
		practice_min: z.number().int().min(1).max(500).optional(),
		practice_max: z.number().int().min(0).max(500).optional().describe("0 quita el máximo")
	}),
	async run({ db, actor }, input) {
		await ownedParent(db, actor, input.classroom_id, "exams", input.exam_id);
		const { data } = await db
			.from("exams")
			.select("repeat_mode, repeat_days, repeat_hours, practice_min, practice_max")
			.eq("id", input.exam_id)
			.maybeSingle();
		const current = data as {
			repeat_mode: string;
			repeat_days: number | null;
			repeat_hours: number | null;
			practice_min: number;
			practice_max: number | null;
		} | null;
		if (!current) throw new ToolError(NOT_FOUND);

		const periodic = input.repeatable === undefined ? current.repeat_mode === "periodico" : input.repeatable;
		const days = input.repeat_days ?? current.repeat_days ?? 0;
		const hours = input.repeat_hours ?? current.repeat_hours ?? 0;
		if (periodic && hours === 0 && (days < 1 || days > 365))
			throw new ToolError("Indica cada cuánto se puede repetir, en horas o en días.");
		const min = input.practice_min ?? current.practice_min;
		const max = input.practice_max === undefined ? current.practice_max : input.practice_max === 0 ? null : input.practice_max;
		if (max !== null && max < min) throw new ToolError("El máximo del simulacro no puede ser menor que el mínimo.");
		if (input.practice_enabled) {
			const { count } = await db.from("exam_questions").select("id", { count: "exact", head: true }).eq("exam_id", input.exam_id);
			if ((count ?? 0) < LIMITS.practiceMinPool)
				throw new ToolError(`El simulacro necesita al menos ${LIMITS.practiceMinPool} preguntas en el examen.`);
		}

		const repeatTouched =
			input.repeatable !== undefined ||
			input.repeat_days !== undefined ||
			input.repeat_hours !== undefined ||
			input.max_attempts !== undefined;
		const patch = defined({
			title: input.title,
			description: input.description,
			is_published: input.published,
			...(repeatTouched
				? {
						repeat_mode: periodic ? "periodico" : "una_vez",
						repeat_days: periodic ? Math.min(Math.max(days, 1), 365) : null,
						repeat_hours: periodic && hours > 0 ? hours : null,
						max_attempts: periodic ? (input.max_attempts ?? null) : null
					}
				: {}),
			pass_percent: input.pass_percent,
			time_limit_minutes:
				input.time_limit_minutes === undefined ? undefined : input.time_limit_minutes === 0 ? null : input.time_limit_minutes,
			review_mode: input.review_mode,
			feedback_pass: input.feedback_pass,
			feedback_fail: input.feedback_fail,
			practice_enabled: input.practice_enabled,
			practice_min: input.practice_min,
			practice_max: input.practice_max === undefined ? undefined : max
		});
		if (Object.keys(patch).length === 0) throw new ToolError("No indicaste nada que cambiar.");
		const { error } = await db.from("exams").update(patch).eq("id", input.exam_id);
		if (error) throw new ToolError("No pudimos guardar el examen.");
		return { exam_id: input.exam_id, updated: Object.keys(patch) };
	}
});

export const deleteExam = defineTool({
	name: "delete_exam",
	title: "Borrar examen",
	description: "Borra definitivamente un examen con sus preguntas e intentos. Irreversible: pide confirmación explícita a la persona.",
	level: "team",
	readOnly: false,
	destructive: true,
	input: z.object({ classroom_id: id("Aula"), exam_id: id("Examen"), confirm }),
	async run({ db, actor }, input) {
		await ownedParent(db, actor, input.classroom_id, "exams", input.exam_id);
		const { error } = await db.from("exams").delete().eq("id", input.exam_id);
		if (error) throw new ToolError("No pudimos borrar el examen.");
		return { deleted: true };
	}
});

export const saveExamQuestion = defineTool({
	name: "save_exam_question",
	title: "Crear o editar una pregunta de examen",
	description: "Crea una pregunta de examen o edita una existente (envía question_id). Para muchas preguntas usa add_exam_questions.",
	level: "team",
	readOnly: false,
	input: z
		.object({
			classroom_id: id("Aula"),
			exam_id: id("Examen"),
			question_id: id("Pregunta a editar").optional(),
			prompt: text(2000, "Pregunta"),
			options: z.array(text(500, "Opción")).min(2).max(6),
			correct: z.number().int().min(1).max(6).describe("Número de la opción correcta, desde 1"),
			explanation: optionalText(3000, "Explicación"),
			topic: optionalText(80, "Tema"),
			session_id: id("Lección del módulo que conviene repasar").optional(),
			position: z.number().int().min(1).max(10_000).optional()
		})
		.refine((item) => item.correct <= item.options.length, { error: "La opción correcta está fuera de rango." }),
	async run({ db, actor }, input) {
		const { moduleId } = await ownedParent(db, actor, input.classroom_id, "exams", input.exam_id);
		const sessionId = await lessonInModule(db, moduleId, input.session_id);
		const row = defined({
			exam_id: input.exam_id,
			prompt: input.prompt,
			options: input.options,
			correct_index: input.correct - 1,
			explanation: input.explanation,
			topic: input.topic,
			session_id: sessionId,
			position: input.position ?? (input.question_id ? undefined : await nextPosition(db, "exam_questions", "exam_id", input.exam_id))
		});
		if (input.question_id) {
			const { data, error } = await db
				.from("exam_questions")
				.update(row)
				.eq("id", input.question_id)
				.eq("exam_id", input.exam_id)
				.select("id")
				.maybeSingle();
			if (error) throw new ToolError("No pudimos guardar la pregunta.");
			if (!data) throw new ToolError(NOT_FOUND);
			return { question_id: input.question_id };
		}
		const { count } = await db.from("exam_questions").select("id", { count: "exact", head: true }).eq("exam_id", input.exam_id);
		if ((count ?? 0) >= LIMITS.examQuestions) throw new ToolError(`Un examen admite hasta ${LIMITS.examQuestions} preguntas.`);
		const { data, error } = await db.from("exam_questions").insert(row).select("id").single();
		if (error || !data) throw new ToolError("No pudimos guardar la pregunta.");
		return { question_id: (data as { id: string }).id };
	}
});

export const deleteExamQuestion = defineTool({
	name: "delete_exam_question",
	title: "Borrar pregunta de examen",
	description: "Borra una pregunta de un examen.",
	level: "team",
	readOnly: false,
	destructive: true,
	input: z.object({ classroom_id: id("Aula"), question_id: id("Pregunta") }),
	async run({ db, actor }, input) {
		await questionExam(db, actor, input.classroom_id, input.question_id);
		const { error } = await db.from("exam_questions").delete().eq("id", input.question_id);
		if (error) throw new ToolError("No pudimos borrar la pregunta.");
		return { deleted: true };
	}
});

export const getScenario = defineTool({
	name: "get_scenario",
	title: "Detalle del escenario",
	description: "Devuelve un escenario con su respuesta de referencia, mensajes de resultado y rúbrica (criterios con sus IDs).",
	level: "team",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula"), scenario_id: id("Escenario") }),
	async run({ db, actor }, input) {
		await ownedParent(db, actor, input.classroom_id, "scenarios", input.scenario_id);
		const [{ data: scenario }, { data: solution }, { data: criteria }] = await Promise.all([
			db.from("scenarios").select("*").eq("id", input.scenario_id).maybeSingle(),
			db.from("scenario_solutions").select("model_answer, feedback_pass, feedback_fail").eq("scenario_id", input.scenario_id).maybeSingle(),
			db
				.from("scenario_criteria")
				.select("id, label, if_met, if_missed, topic, session_id, weight, position")
				.eq("scenario_id", input.scenario_id)
				.order("position")
		]);
		if (!scenario) throw new ToolError(NOT_FOUND);
		return {
			scenario,
			solution: solution ?? null,
			criteria: ((criteria ?? []) as { id: string }[]).map(({ id: criterionId, ...rest }) => ({ criterion_id: criterionId, ...rest }))
		};
	}
});

export const updateScenario = defineTool({
	name: "update_scenario",
	title: "Editar escenario",
	description:
		"Cambia un escenario y su respuesta de referencia. Solo se modifica lo que envíes. Confirma con la persona antes de publicar.",
	level: "team",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		scenario_id: id("Escenario"),
		title: z
			.string()
			.optional()
			.transform((value) => (value === undefined ? undefined : value.trim().slice(0, 160)))
			.pipe(z.string().min(1).optional()),
		situation: z
			.string()
			.optional()
			.describe("Situación a resolver")
			.transform((value) => (value === undefined ? undefined : value.trim()))
			.pipe(z.string().min(1).max(8000).optional()),
		question: patchMarkdown(2000, "Qué se pide"),
		published: z.boolean().optional(),
		min_chars: z.number().int().min(20).max(2000).optional(),
		repeatable: z.boolean().optional(),
		repeat_days: z.number().int().min(1).max(365).optional(),
		max_attempts: z.number().int().min(1).max(50).optional(),
		pass_percent: z.number().int().min(1).max(100).optional(),
		model_answer: patchMarkdown(8000, "Respuesta de referencia"),
		feedback_pass: patchText(600, "Mensaje si aprueba"),
		feedback_fail: patchText(600, "Mensaje si no aprueba")
	}),
	async run({ db, actor }, input) {
		await ownedParent(db, actor, input.classroom_id, "scenarios", input.scenario_id);
		const { data } = await db.from("scenarios").select("repeat_mode, repeat_days").eq("id", input.scenario_id).maybeSingle();
		const current = data as { repeat_mode: string; repeat_days: number | null } | null;
		if (!current) throw new ToolError(NOT_FOUND);
		const periodic = input.repeatable === undefined ? current.repeat_mode === "periodico" : input.repeatable;
		const days = input.repeat_days ?? current.repeat_days ?? 0;
		if (periodic && (days < 1 || days > 365)) throw new ToolError("Indica cada cuántos días se puede repetir, de 1 a 365.");

		const repeatTouched = input.repeatable !== undefined || input.repeat_days !== undefined || input.max_attempts !== undefined;
		const patch = defined({
			title: input.title,
			situation: input.situation,
			question: input.question,
			is_published: input.published,
			min_chars: input.min_chars,
			pass_percent: input.pass_percent,
			...(repeatTouched
				? {
						repeat_mode: periodic ? "periodico" : "una_vez",
						repeat_days: periodic ? days : null,
						max_attempts: periodic ? (input.max_attempts ?? null) : null
					}
				: {})
		});
		const solution = defined({ model_answer: input.model_answer, feedback_pass: input.feedback_pass, feedback_fail: input.feedback_fail });
		if (Object.keys(patch).length === 0 && Object.keys(solution).length === 0) throw new ToolError("No indicaste nada que cambiar.");

		if (Object.keys(patch).length > 0) {
			const { error } = await db.from("scenarios").update(patch).eq("id", input.scenario_id);
			if (error) throw new ToolError("No pudimos guardar el escenario.");
		}
		if (Object.keys(solution).length > 0) {
			const { error } = await db
				.from("scenario_solutions")
				.upsert({ scenario_id: input.scenario_id, ...solution }, { onConflict: "scenario_id" });
			if (error) throw new ToolError("No pudimos guardar la respuesta de referencia.");
		}
		return { scenario_id: input.scenario_id, updated: [...Object.keys(patch), ...Object.keys(solution)] };
	}
});

export const deleteScenario = defineTool({
	name: "delete_scenario",
	title: "Borrar escenario",
	description: "Borra definitivamente un escenario con su rúbrica y respuestas. Irreversible: pide confirmación explícita a la persona.",
	level: "team",
	readOnly: false,
	destructive: true,
	input: z.object({ classroom_id: id("Aula"), scenario_id: id("Escenario"), confirm }),
	async run({ db, actor }, input) {
		await ownedParent(db, actor, input.classroom_id, "scenarios", input.scenario_id);
		const { error } = await db.from("scenarios").delete().eq("id", input.scenario_id);
		if (error) throw new ToolError("No pudimos borrar el escenario.");
		return { deleted: true };
	}
});

export const saveScenarioCriterion = defineTool({
	name: "save_scenario_criterion",
	title: "Crear o editar un criterio de la rúbrica",
	description: "Crea un criterio de la rúbrica de un escenario o edita uno existente (envía criterion_id).",
	level: "team",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		scenario_id: id("Escenario"),
		criterion_id: id("Criterio a editar").optional(),
		label: text(500, "Qué debe contener una buena respuesta"),
		if_met: optionalText(600, "Mensaje si lo cumple"),
		if_missed: optionalText(600, "Pista si no lo cumple"),
		topic: optionalText(80, "Tema"),
		session_id: id("Lección del módulo que conviene repasar").optional(),
		weight: z.number().int().min(1).max(5).default(1),
		position: z.number().int().min(1).max(200).optional()
	}),
	async run({ db, actor }, input) {
		const { moduleId } = await ownedParent(db, actor, input.classroom_id, "scenarios", input.scenario_id);
		const sessionId = await lessonInModule(db, moduleId, input.session_id);
		const row = defined({
			scenario_id: input.scenario_id,
			label: input.label,
			if_met: input.if_met,
			if_missed: input.if_missed,
			topic: input.topic,
			session_id: sessionId,
			weight: input.weight,
			position:
				input.position ?? (input.criterion_id ? undefined : await nextPosition(db, "scenario_criteria", "scenario_id", input.scenario_id))
		});
		if (input.criterion_id) {
			const { data, error } = await db
				.from("scenario_criteria")
				.update(row)
				.eq("id", input.criterion_id)
				.eq("scenario_id", input.scenario_id)
				.select("id")
				.maybeSingle();
			if (error) throw new ToolError("No pudimos guardar el criterio.");
			if (!data) throw new ToolError(NOT_FOUND);
			return { criterion_id: input.criterion_id };
		}
		const { data, error } = await db.from("scenario_criteria").insert(row).select("id").single();
		if (error || !data) throw new ToolError("No pudimos guardar el criterio.");
		return { criterion_id: (data as { id: string }).id };
	}
});

export const deleteScenarioCriterion = defineTool({
	name: "delete_scenario_criterion",
	title: "Borrar criterio de la rúbrica",
	description: "Borra un criterio de la rúbrica de un escenario.",
	level: "team",
	readOnly: false,
	destructive: true,
	input: z.object({ classroom_id: id("Aula"), criterion_id: id("Criterio") }),
	async run({ db, actor }, input) {
		await criterionScenario(db, actor, input.classroom_id, input.criterion_id);
		const { error } = await db.from("scenario_criteria").delete().eq("id", input.criterion_id);
		if (error) throw new ToolError("No pudimos borrar el criterio.");
		return { deleted: true };
	}
});

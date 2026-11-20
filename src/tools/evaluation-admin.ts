import { z } from "zod";
import { aliases } from "../domain/aliases.js";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { defined, id, patchMarkdown, patchText } from "../domain/sanitize.js";
import { ENUMS, LIMITS } from "../limits.js";
import { rawText } from "../mcp/encode.js";
import { defineTool } from "../mcp/tool.js";
import { ownedParent } from "./evaluations.js";

const confirm = z.literal(true).describe("Debe ser true: la persona confirmó esta acción irreversible");

async function _questionExam(
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

async function _criterionScenario(
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

async function _lessonInModule(db: Parameters<typeof ownedParent>[0], moduleId: string, sessionId: string | undefined) {
	if (!sessionId) return null;
	const { data } = await db.from("sessions").select("id").eq("id", sessionId).eq("module_id", moduleId).maybeSingle();
	if (!data) throw new ToolError("Elige una lección de este módulo.");
	return sessionId;
}

const EXAM_COLUMNS =
	"title, description, is_published, repeat_mode, repeat_days, repeat_hours, max_attempts, pass_percent, time_limit_minutes, review_mode, feedback_pass, feedback_fail, practice_enabled, practice_min, practice_max";
const QUESTION_FIELDS = ["prompt", "options", "correct", "explanation", "topic", "lesson"] as const;
type QuestionRow = {
	id: string;
	prompt: string;
	options: string[];
	correct_index: number;
	explanation: string | null;
	topic: string | null;
	session_id: string | null;
};

const pipe = (value: string) => value.replace(/\r?\n/g, "\\n").replace(/\|/g, "/");

/** Mismo formato que la carga masiva, con el ID delante: se edita y se reenvía con edit_items. */
export function questionLine(
	row: QuestionRow,
	fields: ReadonlySet<string>,
	lessonNumber: (id: string | null) => number | undefined,
	ref: string
) {
	const parts = [ref, pipe(row.prompt)];
	if (fields.has("options")) parts.push(...row.options.map((option, index) => `${index === row.correct_index ? "*" : ""}${pipe(option)}`));
	if (fields.has("explanation") && row.explanation) parts.push(`explicación: ${pipe(row.explanation)}`);
	if (fields.has("topic") && row.topic) parts.push(`tema: ${pipe(row.topic)}`);
	const lesson = fields.has("lesson") ? lessonNumber(row.session_id) : undefined;
	if (lesson) parts.push(`lección: ${lesson}`);
	return parts.join(" | ");
}

export const getExam = defineTool({
	name: "get_exam",
	title: "Detalle del examen",
	description:
		"Configuración de un examen y, si se piden, sus preguntas. view: «resumen» (configuración, total y temas; por defecto), «preguntas» (tabla) o «lineas» (formato de carga con ID delante, ideal para corregir y reenviar con edit_items). fields limita columnas; topic y search filtran; offset/limit paginan.",
	level: "team",
	readOnly: true,
	input: z.object({
		classroom_id: id("Aula"),
		exam_id: id("Examen"),
		view: z.enum(["resumen", "preguntas", "lineas"]).default("resumen"),
		fields: z.array(z.enum(QUESTION_FIELDS)).optional().describe("Por defecto prompt, options, correct"),
		topic: z.string().max(80).optional(),
		search: z.string().max(120).optional().describe("Texto dentro del enunciado"),
		offset: z.number().int().min(0).max(10_000).default(0),
		limit: z.number().int().min(1).max(LIMITS.bulkQuestions).default(LIMITS.pageDefault)
	}),
	async run({ db, actor }, input) {
		const { moduleId } = await ownedParent(db, actor, input.classroom_id, "exams", input.exam_id);
		if (input.view === "resumen") {
			const [{ data: exam }, { data: topics, count }] = await Promise.all([
				db.from("exams").select(EXAM_COLUMNS).eq("id", input.exam_id).maybeSingle(),
				db.from("exam_questions").select("topic", { count: "exact" }).eq("exam_id", input.exam_id).limit(LIMITS.examQuestions)
			]);
			if (!exam) throw new ToolError(NOT_FOUND);
			const byTopic = new Map<string, number>();
			for (const row of (topics ?? []) as { topic: string | null }[]) {
				const key = row.topic?.trim() || "(sin tema)";
				byTopic.set(key, (byTopic.get(key) ?? 0) + 1);
			}
			return {
				...(exam as Record<string, unknown>),
				questions: count ?? 0,
				topics: [...byTopic].map(([topic, total]) => ({ topic, total }))
			};
		}

		const fields = new Set<string>(input.fields ?? ["prompt", "options", "correct"]);
		fields.add("prompt");
		let query = db
			.from("exam_questions")
			.select("id, prompt, options, correct_index, explanation, topic, session_id", { count: "exact" })
			.eq("exam_id", input.exam_id);
		if (input.topic) query = query.ilike("topic", input.topic.replace(/[%_]/g, ""));
		if (input.search) query = query.ilike("prompt", `%${input.search.replace(/[%_]/g, "")}%`);
		const [{ data, count }, { data: sessions }] = await Promise.all([
			query.order("position").range(input.offset, input.offset + input.limit - 1),
			fields.has("lesson") ? db.from("sessions").select("id, number").eq("module_id", moduleId) : Promise.resolve({ data: [] })
		]);
		const rows = (data ?? []) as QuestionRow[];
		const numbers = new Map(((sessions ?? []) as { id: string; number: number }[]).map((row) => [row.id, row.number]));
		const lessonNumber = (sessionId: string | null) => (sessionId ? numbers.get(sessionId) : undefined);
		const total = count ?? rows.length;
		const next = input.offset + rows.length < total ? input.offset + rows.length : null;

		if (input.view === "lineas") {
			const header = `# ${rows.length} de ${total} preguntas${next !== null ? ` (siguiente offset=${next})` : ""}`;
			const lines = rows.map((row) => questionLine(row, fields, lessonNumber, aliases.alias(row.id)));
			return rawText([header, ...lines].join("\n"));
		}
		return {
			total,
			...(next !== null ? { next_offset: next } : {}),
			questions: rows.map((row) => ({
				id: row.id,
				prompt: row.prompt,
				...(fields.has("options") ? { options: row.options } : {}),
				...(fields.has("correct") ? { correct: row.correct_index + 1 } : {}),
				...(fields.has("explanation") ? { explanation: row.explanation } : {}),
				...(fields.has("topic") ? { topic: row.topic } : {}),
				...(fields.has("lesson") ? { lesson: lessonNumber(row.session_id) } : {})
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

export const getScenario = defineTool({
	name: "get_scenario",
	title: "Detalle del escenario",
	description: "Escenario con su respuesta de referencia, mensajes de resultado y rúbrica (criterios con ID, editables con edit_items).",
	level: "team",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula"), scenario_id: id("Escenario") }),
	async run({ db, actor }, input) {
		await ownedParent(db, actor, input.classroom_id, "scenarios", input.scenario_id);
		const [{ data: scenario }, { data: solution }, { data: criteria }] = await Promise.all([
			db
				.from("scenarios")
				.select("title, situation, question, is_published, repeat_mode, repeat_days, max_attempts, pass_percent, min_chars")
				.eq("id", input.scenario_id)
				.maybeSingle(),
			db.from("scenario_solutions").select("model_answer, feedback_pass, feedback_fail").eq("scenario_id", input.scenario_id).maybeSingle(),
			db
				.from("scenario_criteria")
				.select("id, label, if_met, if_missed, topic, weight")
				.eq("scenario_id", input.scenario_id)
				.order("position")
		]);
		if (!scenario) throw new ToolError(NOT_FOUND);
		return {
			scenario,
			solution: solution ?? null,
			criteria: criteria ?? []
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

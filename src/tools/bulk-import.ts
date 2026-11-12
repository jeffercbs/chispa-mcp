import { z } from "zod";
import { describeIssues, parseCardLines } from "../domain/bulk.js";
import { ToolError } from "../domain/errors.js";
import { id, markdown, optionalText, text } from "../domain/sanitize.js";
import { ENUMS, LIMITS } from "../limits.js";
import { defineTool } from "../mcp/tool.js";
import { collectQuestions, examQuestion, questionRows } from "./evaluations.js";
import { quizQuestion } from "./lesson-items.js";
import { ownedModule } from "./ownership.js";
import { insertChunks } from "./shared.js";

const repeat = {
	repeatable: z.boolean().default(false).describe("Si se puede repetir cada cierto tiempo"),
	repeat_days: z.number().int().min(1).max(365).default(7),
	max_attempts: z.number().int().min(1).max(50).optional(),
	pass_percent: z.number().int().min(1).max(100).default(60)
};

export const importExam = defineTool({
	name: "import_exam",
	title: "Crear un examen completo con sus preguntas",
	description: `Crea un simulacro o examen y carga todas sus preguntas en una sola llamada (hasta ${LIMITS.bulkQuestions}). Es todo o nada: si algo falla no queda un examen a medias. Formato de texto: una pregunta por línea «enunciado | opción | *correcta | opción | explicación: … | tema: … | lección: 2». Usa dry_run=true primero para validar sin guardar. Queda en borrador.`,
	level: "team",
	readOnly: false,
	input: z
		.object({
			classroom_id: id("Aula"),
			module_id: id("Módulo"),
			title: text(160, "Título"),
			description: optionalText(2000, "Instrucciones"),
			time_limit_minutes: z.number().int().min(1).max(600).optional(),
			review_mode: z.enum(ENUMS.reviewMode).default("explicaciones"),
			...repeat,
			questions: z.array(examQuestion).max(LIMITS.bulkQuestions).optional().describe("Preguntas en JSON"),
			questions_text: z.string().max(400_000).optional().describe("Preguntas en texto compacto"),
			dry_run: z.boolean().default(false)
		})
		.refine((input) => (input.questions?.length ?? 0) > 0 || Boolean(input.questions_text?.trim()), {
			error: "Envía `questions` o `questions_text`."
		}),
	async run({ db, actor }, input) {
		await ownedModule(db, actor, input.classroom_id, input.module_id);
		const items = collectQuestions(input);
		const draftId = "00000000-0000-4000-8000-000000000000";
		await questionRows(db, input.module_id, draftId, items, 1); // valida las lecciones citadas antes de crear nada

		if (input.dry_run)
			return { dry_run: true, valid: true, would_create_questions: items.length, preview: items.slice(0, 3).map((item) => item.prompt) };

		const { data, error } = await db
			.from("exams")
			.insert({
				module_id: input.module_id,
				title: input.title,
				description: input.description,
				is_published: false,
				repeat_mode: input.repeatable ? "periodico" : "una_vez",
				repeat_days: input.repeatable ? input.repeat_days : null,
				repeat_hours: null,
				max_attempts: input.repeatable ? (input.max_attempts ?? null) : null,
				pass_percent: input.pass_percent,
				time_limit_minutes: input.time_limit_minutes ?? null,
				review_mode: input.review_mode,
				practice_enabled: false,
				practice_min: 5,
				practice_max: null
			})
			.select("id")
			.single();
		if (error || !data) throw new ToolError("No pudimos crear el examen.");
		const examId = (data as { id: string }).id;

		try {
			const rows = await questionRows(db, input.module_id, examId, items, 1);
			await insertChunks(db, "exam_questions", rows, "No pudimos guardar las preguntas.");
		} catch (failure) {
			await db.from("exams").delete().eq("id", examId); // las preguntas caen por cascada
			throw failure;
		}
		return { exam_id: examId, questions: items.length, published: false };
	}
});

const lesson = z.object({
	title: text(200, "Título de la lección"),
	summary: optionalText(600, "Resumen"),
	content: markdown(LIMITS.richText, "Contenido en Markdown"),
	key_idea: optionalText(400, "Idea clave"),
	objectives: z.array(text(300, "Objetivo")).max(20).optional(),
	format: z.enum(["lectura", "presentacion", "actividad"]).default("lectura").describe("«presentacion» muestra el contenido como diapositivas"),
	quiz: z.array(quizQuestion).max(50).optional().describe("Preguntas de quiz de esta lección"),
	cards_text: z.string().max(100_000).optional().describe("Tarjetas, una por línea: «anverso | reverso»")
});

export const importModuleContent = defineTool({
	name: "import_module_content",
	title: "Cargar varias lecciones con su quiz y tarjetas",
	description: `Crea hasta ${LIMITS.bulkLessons} lecciones al final de un módulo, cada una con su quiz y sus tarjetas, en una sola llamada. Es todo o nada. Usa dry_run=true para validar primero. Quedan en borrador salvo publish=true (confirma con la persona antes de publicar).`,
	level: "team",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		module_id: id("Módulo"),
		lessons: z.array(lesson).min(1).max(LIMITS.bulkLessons),
		publish: z.boolean().default(false),
		dry_run: z.boolean().default(false)
	}),
	async run({ db, actor }, input) {
		const { courseId } = await ownedModule(db, actor, input.classroom_id, input.module_id);

		const cards = input.lessons.map((item, index) => {
			if (!item.cards_text) return [];
			const parsed = parseCardLines(item.cards_text, LIMITS.bulkFlashcards);
			if (parsed.issues.length > 0)
				throw new ToolError(
					`Tarjetas de la lección ${index + 1} («${item.title}»):\n${describeIssues(parsed.issues, LIMITS.issuesShown)}`,
					"Corrige esas líneas y vuelve a enviar la carga."
				);
			return parsed.cards;
		});
		const totals = {
			lessons: input.lessons.length,
			quiz_questions: input.lessons.reduce((sum, item) => sum + (item.quiz?.length ?? 0), 0),
			flashcards: cards.reduce((sum, list) => sum + list.length, 0)
		};
		if (input.dry_run) return { dry_run: true, valid: true, would_create: totals, titles: input.lessons.map((item) => item.title) };

		const { data: last } = await db
			.from("sessions")
			.select("position")
			.eq("module_id", input.module_id)
			.order("position", { ascending: false })
			.limit(1);
		const start = ((last as { position: number }[] | null)?.[0]?.position ?? 0) + 1;

		const { data: created, error } = await db
			.from("sessions")
			.insert(
				input.lessons.map((item, index) => ({
					module_id: input.module_id,
					title: item.title,
					summary: item.summary,
					content: item.content,
					key_idea: item.key_idea,
					objectives: item.objectives ?? [],
					format: item.format,
					is_published: input.publish,
					position: start + index,
					number: start + index
				}))
			)
			.select("id, position");
		const sessions = ((created ?? []) as { id: string; position: number }[]).sort((a, b) => a.position - b.position);
		if (error || sessions.length !== input.lessons.length) {
			if (sessions.length > 0)
				await db
					.from("sessions")
					.delete()
					.in(
						"id",
						sessions.map((row) => row.id)
					);
			throw new ToolError("No pudimos crear las lecciones.");
		}

		try {
			const quizRows = input.lessons.flatMap((item, index) =>
				(item.quiz ?? []).map((question, position) => ({
					session_id: sessions[index]?.id,
					prompt: question.prompt,
					options: question.options,
					correct_index: question.correct - 1,
					explanation: question.explanation,
					difficulty: question.difficulty,
					position: position + 1
				}))
			);
			const cardRows = cards.flatMap((list, index) =>
				list.map((card, position) => ({
					course_id: courseId,
					session_id: sessions[index]?.id,
					front: card.front,
					back: card.back,
					is_published: true,
					position: position + 1
				}))
			);
			await insertChunks(db, "quiz_questions", quizRows, "No pudimos guardar el quiz.");
			await insertChunks(db, "flashcards", cardRows, "No pudimos guardar las tarjetas.");
		} catch (failure) {
			await db
				.from("sessions")
				.delete()
				.in(
					"id",
					sessions.map((row) => row.id)
				); // quiz y tarjetas caen por cascada
			throw failure;
		}
		return {
			created: totals,
			lessons: sessions.map((row, index) => ({ session_id: row.id, number: row.position, title: input.lessons[index]?.title })),
			published: input.publish
		};
	}
});

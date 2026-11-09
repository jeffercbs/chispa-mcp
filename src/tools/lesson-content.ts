import { z } from "zod";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { defined, id, markdown, text } from "../domain/sanitize.js";
import { defineTool } from "../mcp/tool.js";
import { nextPosition, ownedCourse, ownedSession, ownedSessionRow } from "./ownership.js";

const quizShape = {
	prompt: text(1000, "Pregunta"),
	options: z.array(text(300, "Opción")).min(2).max(6).describe("De 2 a 6 opciones"),
	correct: z.number().int().min(1).max(6).describe("Número de la opción correcta, desde 1"),
	explanation: z.string().max(1000).optional().describe("Por qué esa es la correcta"),
	difficulty: z.number().int().min(1).max(5).optional().describe("1 fácil, 5 difícil"),
	position: z.number().int().min(1).max(10_000).optional()
};

const explain = (value: string | undefined) => (value?.trim() ? value.trim().slice(0, 1000) : null);

export const listLessonItems = defineTool({
	name: "list_lesson_items",
	title: "Material de una lección",
	description:
		"Lista con sus IDs el quiz, las preguntas de autoevaluación, las tarjetas y los juegos de una lección, para poder editarlos o borrarlos.",
	level: "team",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula"), session_id: id("Lección") }),
	async run({ db, actor }, input) {
		await ownedSession(db, actor, input.classroom_id, input.session_id);
		const pick = (table: string, columns: string) => db.from(table).select(columns).eq("session_id", input.session_id).order("position");
		const [quiz, self, cards, games] = await Promise.all([
			pick("quiz_questions", "id, prompt, options, correct_index, explanation, difficulty, position"),
			pick("session_questions", "id, question, answer, position"),
			pick("flashcards", "id, front, back, is_published, position"),
			pick("interactive_activities", "id, kind, title, prompt, is_published, position")
		]);
		return {
			quiz_questions: ((quiz.data ?? []) as unknown as { id: string; correct_index: number }[]).map((row) => ({
				...row,
				question_id: row.id,
				correct: row.correct_index + 1,
				id: undefined,
				correct_index: undefined
			})),
			self_check_questions: self.data ?? [],
			flashcards: cards.data ?? [],
			games: games.data ?? []
		};
	}
});

export const saveQuizQuestion = defineTool({
	name: "save_quiz_question",
	title: "Crear o editar una pregunta de quiz",
	description: "Crea una pregunta de quiz en una lección o edita una existente (envía question_id).",
	level: "team",
	readOnly: false,
	input: z
		.object({ classroom_id: id("Aula"), session_id: id("Lección"), question_id: id("Pregunta a editar").optional(), ...quizShape })
		.refine((item) => item.correct <= item.options.length, { error: "La opción correcta está fuera de rango." }),
	async run({ db, actor }, input) {
		await ownedSession(db, actor, input.classroom_id, input.session_id);
		const row = defined({
			session_id: input.session_id,
			prompt: input.prompt,
			options: input.options,
			correct_index: input.correct - 1,
			explanation: explain(input.explanation),
			difficulty: input.difficulty,
			position: input.position ?? (input.question_id ? undefined : await nextPosition(db, "quiz_questions", "session_id", input.session_id))
		});
		if (input.question_id) {
			const { data } = await db.from("quiz_questions").select("session_id").eq("id", input.question_id).maybeSingle();
			if ((data as { session_id: string } | null)?.session_id !== input.session_id) throw new ToolError(NOT_FOUND);
			const { error } = await db.from("quiz_questions").update(row).eq("id", input.question_id);
			if (error) throw new ToolError("No pudimos guardar la pregunta.");
			return { question_id: input.question_id };
		}
		const { data, error } = await db.from("quiz_questions").insert(row).select("id").single();
		if (error || !data) throw new ToolError("No pudimos guardar la pregunta.");
		return { question_id: (data as { id: string }).id };
	}
});

export const deleteQuizQuestion = defineTool({
	name: "delete_quiz_question",
	title: "Borrar pregunta de quiz",
	description: "Borra una pregunta del quiz de una lección.",
	level: "team",
	readOnly: false,
	destructive: true,
	input: z.object({ classroom_id: id("Aula"), question_id: id("Pregunta") }),
	async run({ db, actor }, input) {
		await ownedSessionRow(db, actor, input.classroom_id, "quiz_questions", input.question_id);
		const { error } = await db.from("quiz_questions").delete().eq("id", input.question_id);
		if (error) throw new ToolError("No pudimos borrar la pregunta.");
		return { deleted: true };
	}
});

export const saveSelfCheckQuestion = defineTool({
	name: "save_self_check_question",
	title: "Crear o editar una pregunta de autoevaluación",
	description:
		"Crea una pregunta de autoevaluación (pregunta y respuesta abiertas) en una lección o edita una existente (envía question_id).",
	level: "team",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		session_id: id("Lección"),
		question_id: id("Pregunta a editar").optional(),
		question: markdown(2000, "Pregunta"),
		answer: markdown(4000, "Respuesta"),
		position: z.number().int().min(1).max(10_000).optional()
	}),
	async run({ db, actor }, input) {
		await ownedSession(db, actor, input.classroom_id, input.session_id);
		const row = defined({
			session_id: input.session_id,
			question: input.question,
			answer: input.answer,
			position:
				input.position ?? (input.question_id ? undefined : await nextPosition(db, "session_questions", "session_id", input.session_id))
		});
		if (input.question_id) {
			const { data } = await db.from("session_questions").select("session_id").eq("id", input.question_id).maybeSingle();
			if ((data as { session_id: string } | null)?.session_id !== input.session_id) throw new ToolError(NOT_FOUND);
			const { error } = await db.from("session_questions").update(row).eq("id", input.question_id);
			if (error) throw new ToolError("No pudimos guardar la pregunta.");
			return { question_id: input.question_id };
		}
		const { data, error } = await db.from("session_questions").insert(row).select("id").single();
		if (error || !data) throw new ToolError("No pudimos guardar la pregunta.");
		return { question_id: (data as { id: string }).id };
	}
});

export const deleteSelfCheckQuestion = defineTool({
	name: "delete_self_check_question",
	title: "Borrar pregunta de autoevaluación",
	description: "Borra una pregunta de autoevaluación de una lección.",
	level: "team",
	readOnly: false,
	destructive: true,
	input: z.object({ classroom_id: id("Aula"), question_id: id("Pregunta") }),
	async run({ db, actor }, input) {
		await ownedSessionRow(db, actor, input.classroom_id, "session_questions", input.question_id);
		const { error } = await db.from("session_questions").delete().eq("id", input.question_id);
		if (error) throw new ToolError("No pudimos borrar la pregunta.");
		return { deleted: true };
	}
});

export const saveFlashcard = defineTool({
	name: "save_flashcard",
	title: "Crear o editar una tarjeta",
	description:
		"Crea una tarjeta de repaso o edita una existente (envía card_id). Pasa session_id para una tarjeta de lección, o solo course_id para una del mazo general del curso.",
	level: "team",
	readOnly: false,
	input: z
		.object({
			classroom_id: id("Aula"),
			card_id: id("Tarjeta a editar").optional(),
			session_id: id("Lección").optional(),
			course_id: id("Curso").optional(),
			front: text(600, "Cara delantera"),
			back: text(2000, "Cara trasera"),
			published: z.boolean().default(true),
			position: z.number().int().min(1).max(10_000).optional()
		})
		.refine((item) => item.card_id || item.session_id || item.course_id, {
			error: "Indica la lección (session_id) o el curso (course_id)."
		}),
	async run({ db, actor }, input) {
		let courseId = input.course_id;
		if (input.card_id) {
			const { data } = await db.from("flashcards").select("course_id").eq("id", input.card_id).maybeSingle();
			courseId = (data as { course_id: string | null } | null)?.course_id ?? undefined;
			if (!courseId) throw new ToolError(NOT_FOUND);
			await ownedCourse(db, actor, input.classroom_id, courseId);
		} else if (input.session_id) {
			courseId = (await ownedSession(db, actor, input.classroom_id, input.session_id)).courseId;
		} else if (courseId) {
			await ownedCourse(db, actor, input.classroom_id, courseId);
		}
		if (!courseId) throw new ToolError(NOT_FOUND);

		const row = defined({
			course_id: courseId,
			session_id: input.card_id ? undefined : (input.session_id ?? null),
			front: input.front,
			back: input.back,
			is_published: input.published,
			position:
				input.position ??
				(input.card_id
					? undefined
					: input.session_id
						? await nextPosition(db, "flashcards", "session_id", input.session_id)
						: await nextPosition(db, "flashcards", "course_id", courseId))
		});
		if (input.card_id) {
			const { error } = await db.from("flashcards").update(row).eq("id", input.card_id);
			if (error) throw new ToolError("No pudimos guardar la tarjeta.");
			return { card_id: input.card_id };
		}
		const { data, error } = await db.from("flashcards").insert(row).select("id").single();
		if (error || !data) throw new ToolError("No pudimos guardar la tarjeta.");
		return { card_id: (data as { id: string }).id };
	}
});

export const deleteFlashcard = defineTool({
	name: "delete_flashcard",
	title: "Borrar tarjeta",
	description: "Borra una tarjeta de repaso.",
	level: "team",
	readOnly: false,
	destructive: true,
	input: z.object({ classroom_id: id("Aula"), card_id: id("Tarjeta") }),
	async run({ db, actor }, input) {
		const { data } = await db.from("flashcards").select("course_id, session_id").eq("id", input.card_id).maybeSingle();
		const row = data as { course_id: string | null; session_id: string | null } | null;
		if (!row) throw new ToolError(NOT_FOUND);
		if (row.course_id) await ownedCourse(db, actor, input.classroom_id, row.course_id);
		else if (row.session_id) await ownedSession(db, actor, input.classroom_id, row.session_id);
		else throw new ToolError(NOT_FOUND);
		const { error } = await db.from("flashcards").delete().eq("id", input.card_id);
		if (error) throw new ToolError("No pudimos borrar la tarjeta.");
		return { deleted: true };
	}
});

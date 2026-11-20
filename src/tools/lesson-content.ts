import { z } from "zod";
import { aliases } from "../domain/aliases.js";
import { id } from "../domain/sanitize.js";
import { rawText } from "../mcp/encode.js";
import { defineTool } from "../mcp/tool.js";
import { ownedSession } from "./ownership.js";

const ITEM_GROUPS = ["quiz", "self_check", "flashcards", "games"] as const;

const flat = (value: string) => value.replace(/\r?\n/g, "\\n").replace(/\|/g, "/");

export const listLessonItems = defineTool({
	name: "list_lesson_items",
	title: "Material de una lección",
	description:
		"Quiz, autoevaluación, tarjetas y juegos de una lección con sus IDs. kinds limita qué traer; view «lineas» devuelve el formato de carga con ID delante para corregir y reenviar con edit_items; «tabla» (por defecto) no incluye explicaciones salvo explanations=true.",
	level: "team",
	readOnly: true,
	input: z.object({
		classroom_id: id("Aula"),
		session_id: id("Lección"),
		kinds: z.array(z.enum(ITEM_GROUPS)).optional().describe("Por defecto todos"),
		view: z.enum(["tabla", "lineas"]).default("tabla"),
		explanations: z.boolean().default(false)
	}),
	async run({ db, actor }, input) {
		await ownedSession(db, actor, input.classroom_id, input.session_id);
		const wanted = new Set(input.kinds ?? ITEM_GROUPS);
		const pick = (group: (typeof ITEM_GROUPS)[number], table: string, columns: string) =>
			wanted.has(group)
				? db.from(table).select(columns).eq("session_id", input.session_id).order("position")
				: Promise.resolve({ data: null });
		const [quiz, self, cards, games] = await Promise.all([
			pick(
				"quiz",
				"quiz_questions",
				`id, prompt, options, correct_index${input.explanations || input.view === "lineas" ? ", explanation" : ""}, difficulty`
			),
			pick("self_check", "session_questions", "id, question, answer"),
			pick("flashcards", "flashcards", "id, front, back, is_published"),
			pick("games", "interactive_activities", "id, kind, title, is_published")
		]);
		type Quiz = { id: string; prompt: string; options: string[]; correct_index: number; explanation?: string | null; difficulty: number };
		const quizRows = (quiz.data ?? []) as unknown as Quiz[];
		const selfRows = (self.data ?? []) as unknown as { id: string; question: string; answer: string }[];
		const cardRows = (cards.data ?? []) as unknown as { id: string; front: string; back: string; is_published: boolean }[];
		const gameRows = (games.data ?? []) as unknown as { id: string; kind: string; title: string; is_published: boolean }[];

		if (input.view === "lineas") {
			const out: string[] = [];
			if (wanted.has("quiz"))
				out.push(
					`# quiz (${quizRows.length}) → edit_items kind=quiz_question`,
					...quizRows.map((row) =>
						[
							aliases.alias(row.id),
							flat(row.prompt),
							...row.options.map((option, index) => `${index === row.correct_index ? "*" : ""}${flat(option)}`),
							...(input.explanations && row.explanation ? [`explicación: ${flat(row.explanation)}`] : [])
						].join(" | ")
					)
				);
			if (wanted.has("self_check"))
				out.push(
					`# autoevaluación (${selfRows.length}) → kind=self_check`,
					...selfRows.map((row) => `${aliases.alias(row.id)} | ${flat(row.question)} | ${flat(row.answer)}`)
				);
			if (wanted.has("flashcards"))
				out.push(
					`# tarjetas (${cardRows.length}) → kind=flashcard`,
					...cardRows.map((row) => `${aliases.alias(row.id)} | ${flat(row.front)} | ${flat(row.back)}`)
				);
			if (wanted.has("games"))
				out.push(`# juegos (${gameRows.length})`, ...gameRows.map((row) => `${aliases.alias(row.id)} | ${row.kind} | ${flat(row.title)}`));
			return rawText(out.join("\n"));
		}
		return {
			quiz: quizRows.map((row) => ({
				id: row.id,
				prompt: row.prompt,
				options: row.options,
				correct: row.correct_index + 1,
				difficulty: row.difficulty,
				...(input.explanations ? { explanation: row.explanation } : {})
			})),
			self_check: selfRows,
			flashcards: cardRows.map((row) => ({ id: row.id, front: row.front, back: row.back, published: row.is_published })),
			games: gameRows.map((row) => ({ id: row.id, kind: row.kind, title: row.title, published: row.is_published }))
		};
	}
});

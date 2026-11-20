import { z } from "zod";
import { id } from "../domain/sanitize.js";
import { defineTool } from "../mcp/tool.js";
import { requireCourseInClassroom } from "./shared.js";

const AREAS = ["lessons", "exam_questions", "quiz_questions", "flashcards"] as const;

type Link = { title?: string } | { title?: string }[] | null;
const titleOf = (value: Link) => (Array.isArray(value) ? value[0] : value)?.title ?? "";

export function snippet(text: string, needle: string, size = 80) {
	const flat = text.replace(/\s+/g, " ").trim();
	const at = flat.toLowerCase().indexOf(needle.toLowerCase());
	if (flat.length <= size) return flat;
	const start = Math.max(0, Math.min(at < 0 ? 0 : at - Math.floor(size / 3), flat.length - size));
	return `${start > 0 ? "…" : ""}${flat.slice(start, start + size)}${start + size < flat.length ? "…" : ""}`;
}

export const searchContent = defineTool({
	name: "search_content",
	title: "Buscar en el contenido de un curso",
	description:
		"Busca un texto en títulos y contenido de lecciones, enunciados de exámenes y quizzes y tarjetas de un curso. Devuelve ID, dónde está y un fragmento: úsala antes de leer exámenes o lecciones completos.",
	level: "team",
	readOnly: true,
	input: z.object({
		classroom_id: id("Aula"),
		course_id: id("Curso"),
		query: z.string().trim().min(2).max(120),
		areas: z.array(z.enum(AREAS)).optional().describe("Por defecto todas"),
		limit: z.number().int().min(1).max(50).default(15).describe("Máximo por área")
	}),
	async run({ db }, input) {
		await requireCourseInClassroom(db, input.classroom_id, input.course_id);
		const needle = input.query.replace(/[%_,()*\\"]/g, " ").trim();
		const like = `%${needle}%`;
		const areas = new Set(input.areas ?? AREAS);
		const none = Promise.resolve({ data: null });
		const [lessons, exams, quizzes, cards] = await Promise.all([
			areas.has("lessons")
				? db
						.from("sessions")
						.select("id, number, title, content, modules!inner(title, course_id)")
						.eq("modules.course_id", input.course_id)
						.or(`title.ilike."${like}",content.ilike."${like}"`)
						.limit(input.limit)
				: none,
			areas.has("exam_questions")
				? db
						.from("exam_questions")
						.select("id, prompt, exams!inner(title, modules!inner(course_id))")
						.eq("exams.modules.course_id", input.course_id)
						.ilike("prompt", like)
						.limit(input.limit)
				: none,
			areas.has("quiz_questions")
				? db
						.from("quiz_questions")
						.select("id, prompt, sessions!inner(title, modules!inner(course_id))")
						.eq("sessions.modules.course_id", input.course_id)
						.ilike("prompt", like)
						.limit(input.limit)
				: none,
			areas.has("flashcards")
				? db
						.from("flashcards")
						.select("id, front, back")
						.eq("course_id", input.course_id)
						.or(`front.ilike."${like}",back.ilike."${like}"`)
						.limit(input.limit)
				: none
		]);
		type Row = Record<string, unknown>;
		const results = [
			...((lessons.data ?? []) as Row[]).map((row) => ({
				kind: "lesson",
				id: row.id,
				where: `${titleOf(row.modules as Link)} › lección ${row.number}`,
				text: snippet(
					String(row.title).toLowerCase().includes(needle.toLowerCase()) ? String(row.title) : String(row.content ?? ""),
					needle
				)
			})),
			...((exams.data ?? []) as Row[]).map((row) => ({
				kind: "exam_question",
				id: row.id,
				where: titleOf(row.exams as Link),
				text: snippet(String(row.prompt), needle)
			})),
			...((quizzes.data ?? []) as Row[]).map((row) => ({
				kind: "quiz_question",
				id: row.id,
				where: titleOf(row.sessions as Link),
				text: snippet(String(row.prompt), needle)
			})),
			...((cards.data ?? []) as Row[]).map((row) => ({
				kind: "flashcard",
				id: row.id,
				where: "tarjetas",
				text: snippet(`${row.front} → ${row.back}`, needle)
			}))
		];
		return { found: results.length, results };
	}
});

import { z } from "zod";
import { type AuditQuestion, auditLesson, auditQuestions } from "../domain/content-audit.js";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { id } from "../domain/sanitize.js";
import type { Db } from "../domain/supabase.js";
import { defineTool } from "../mcp/tool.js";
import { ownedParent } from "./evaluations.js";
import { ownedSession } from "./ownership.js";
import { requireCourseInClassroom } from "./shared.js";

const PAGE = 1000;

/** Cuenta filas por columna sin traerlas todas de golpe (la base devuelve como máximo 1000 por consulta). */
export async function countBy(db: Db, table: string, column: string, ids: string[]) {
	const counts = new Map<string, number>();
	for (let start = 0; start < ids.length; start += 40) {
		const slice = ids.slice(start, start + 40);
		for (let offset = 0; ; offset += PAGE) {
			const { data } = await db
				.from(table)
				.select(column)
				.in(column, slice)
				.range(offset, offset + PAGE - 1);
			const rows = (data ?? []) as unknown as Record<string, string>[];
			for (const row of rows) counts.set(row[column] as string, (counts.get(row[column] as string) ?? 0) + 1);
			if (rows.length < PAGE) break;
		}
	}
	return counts;
}

type QuestionRow = { id: string; prompt: string; options: string[]; correct_index: number; explanation: string | null };
const asAudit = (row: QuestionRow): AuditQuestion => ({
	ref: row.id,
	prompt: row.prompt,
	options: row.options,
	correct: row.correct_index + 1,
	explanation: row.explanation
});

export const auditExam = defineTool({
	name: "audit_exam",
	title: "Revisar la calidad de un simulacro o quiz",
	description:
		"Revisa sin cambiar nada un simulacro (exam_id) o el quiz de una lección (session_id) con las reglas de examen real: 30-40 preguntas, caso de 70-100 palabras, explicación con norma y artículo, correcta no más larga en más del 40 %, reparto de posiciones, opciones prohibidas o repetidas, casi duplicados y relleno de plantilla. Devuelve solo los problemas y las preguntas señaladas: úsala antes de leer el examen completo.",
	level: "team",
	readOnly: true,
	input: z
		.object({ classroom_id: id("Aula"), exam_id: id("Examen").optional(), session_id: id("Lección").optional() })
		.refine((input) => Boolean(input.exam_id) !== Boolean(input.session_id), { error: "Indica exam_id o session_id (uno de los dos)." }),
	async run({ db, actor }, input) {
		if (input.exam_id) await ownedParent(db, actor, input.classroom_id, "exams", input.exam_id);
		else if (input.session_id) await ownedSession(db, actor, input.classroom_id, input.session_id);
		const { data } = input.exam_id
			? await db
					.from("exam_questions")
					.select("id, prompt, options, correct_index, explanation")
					.eq("exam_id", input.exam_id)
					.order("position")
					.limit(500)
			: await db
					.from("quiz_questions")
					.select("id, prompt, options, correct_index, explanation")
					.eq("session_id", input.session_id ?? "")
					.order("position")
					.limit(500);
		const rows = (data ?? []) as QuestionRow[];
		if (rows.length === 0) return { questions: 0, issues: ["No tiene preguntas."] };
		return auditQuestions(rows.map(asAudit), { mode: input.exam_id ? "simulacro" : "quiz" });
	}
});

type Lesson = {
	id: string;
	module_id: string;
	number: number;
	title: string;
	format: string;
	summary: string | null;
	objectives: unknown;
	content: string | null;
	key_idea: string | null;
	is_published: boolean;
};

export const auditCourse = defineTool({
	name: "audit_course",
	title: "Auditar la cobertura de un curso",
	description:
		"Revisa sin cambiar nada qué le falta a cada lección y módulo según el estándar de lección completa: resumen, 3+ objetivos, idea clave, 500+ palabras con «Errores frecuentes» y cita de norma, quiz 8+, tarjetas 4+, juego; presentación de 6-15 diapositivas con guion; módulo con presentación y simulacro de 30-40 preguntas; títulos repetidos y contenido truncado. Devuelve solo lo incompleto, con las lecciones publicadas incompletas primero.",
	level: "team",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula"), course_id: id("Curso"), module_id: id("Solo este módulo").optional() }),
	async run({ db }, input) {
		await requireCourseInClassroom(db, input.classroom_id, input.course_id);
		const [{ data: own }, { data: links }] = await Promise.all([
			db.from("modules").select("id, number, title, position").eq("course_id", input.course_id),
			db.from("module_courses").select("module_id, position").eq("course_id", input.course_id)
		]);
		const linkRows = (links ?? []) as { module_id: string; position: number }[];
		const { data: shared } = linkRows.length
			? await db
					.from("modules")
					.select("id, number, title")
					.in(
						"id",
						linkRows.map((link) => link.module_id)
					)
			: { data: [] };
		const positions = new Map(linkRows.map((link) => [link.module_id, link.position]));
		const mods = [
			...((own ?? []) as { id: string; number: number; title: string; position: number }[]),
			...((shared ?? []) as { id: string; number: number; title: string }[]).map((mod) => ({
				...mod,
				position: positions.get(mod.id) ?? 0
			}))
		]
			.sort((a, b) => a.position - b.position)
			.filter((mod) => !input.module_id || mod.id === input.module_id);
		if (mods.length === 0) throw new ToolError(NOT_FOUND);
		const moduleIds = mods.map((mod) => mod.id);
		const [{ data: sessions }, { data: exams }] = await Promise.all([
			db
				.from("sessions")
				.select("id, module_id, number, title, format, summary, objectives, content, key_idea, is_published")
				.in("module_id", moduleIds)
				.order("position")
				.limit(1000),
			db.from("exams").select("id, module_id, title").in("module_id", moduleIds)
		]);
		const lessons = (sessions ?? []) as Lesson[];
		const lessonIds = lessons.map((lesson) => lesson.id);
		const examRows = (exams ?? []) as { id: string; module_id: string; title: string }[];
		const [quiz, cards, games, examCounts] = await Promise.all([
			countBy(db, "quiz_questions", "session_id", lessonIds),
			countBy(db, "flashcards", "session_id", lessonIds),
			countBy(db, "interactive_activities", "session_id", lessonIds),
			countBy(
				db,
				"exam_questions",
				"exam_id",
				examRows.map((exam) => exam.id)
			)
		]);

		const titles = new Map<string, number>();
		for (const lesson of lessons) titles.set(lesson.title.trim().toLowerCase(), (titles.get(lesson.title.trim().toLowerCase()) ?? 0) + 1);
		const rows = lessons
			.map((lesson) => {
				const gaps = auditLesson({
					...lesson,
					quiz: quiz.get(lesson.id) ?? 0,
					flashcards: cards.get(lesson.id) ?? 0,
					games: games.get(lesson.id) ?? 0
				});
				if ((titles.get(lesson.title.trim().toLowerCase()) ?? 0) > 1) gaps.push("título repetido");
				return { lesson, gaps };
			})
			.filter((row) => row.gaps.length > 0)
			.sort((a, b) => Number(b.lesson.is_published) - Number(a.lesson.is_published));

		const moduleGaps = mods
			.map((mod) => {
				const own = lessons.filter((lesson) => lesson.module_id === mod.id);
				const reading = own.filter((lesson) => lesson.format !== "presentacion").length;
				const ownExams = examRows.filter((exam) => exam.module_id === mod.id);
				const gaps: string[] = [];
				if (reading < 2) gaps.push(`lecturas ${reading}/2`);
				if (!own.some((lesson) => lesson.format === "presentacion")) gaps.push("sin presentación del módulo");
				if (ownExams.length === 0) gaps.push("sin simulacro");
				for (const exam of ownExams) {
					const total = examCounts.get(exam.id) ?? 0;
					if (total < 30 || total > 40) gaps.push(`«${exam.title}» con ${total} preguntas (30-40)`);
				}
				return { module: `${mod.number}. ${mod.title}`, gaps: gaps.join("; ") };
			})
			.filter((row) => row.gaps);

		return {
			lessons: lessons.length,
			complete: lessons.length - rows.length,
			incomplete_published: rows.filter((row) => row.lesson.is_published).length,
			modules_with_gaps: moduleGaps,
			lessons_with_gaps: rows.slice(0, 80).map((row) => ({
				id: row.lesson.id,
				lesson: row.lesson.title,
				published: row.lesson.is_published,
				gaps: row.gaps.join("; ")
			})),
			...(rows.length > 80 ? { more: rows.length - 80 } : {})
		};
	}
});

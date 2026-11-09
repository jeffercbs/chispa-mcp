import { z } from "zod";
import { id } from "../domain/sanitize.js";
import { defineTool } from "../mcp/tool.js";
import { classroomCourseIds, requireCourseInClassroom } from "./shared.js";

export const listCourses = defineTool({
	name: "list_courses",
	title: "Cursos del aula",
	description: "Lista los cursos del aula, si están publicados y si los puedes editar.",
	level: "team",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula") }),
	async run({ db, actor }, input) {
		const ids = await classroomCourseIds(db, input.classroom_id);
		if (ids.length === 0) return { courses: [] };
		const { data } = await db.from("courses").select("id, title, slug, is_published").in("id", ids).order("position");
		const rows = (data ?? []) as { id: string; title: string; slug: string; is_published: boolean }[];
		// El administrador del aula puede editar todos sus cursos (can_edit_course → manages_classroom): sin consultas extra.
		const editable =
			actor.role === "administrador"
				? rows.map(() => true)
				: await Promise.all(rows.map(async (course) => (await db.rpc("can_edit_course", { course: course.id })).data === true));
		return {
			courses: rows.map((course, index) => ({
				course_id: course.id,
				title: course.title,
				slug: course.slug,
				published: course.is_published,
				editable: editable[index]
			}))
		};
	}
});

export const getCourseOutline = defineTool({
	name: "get_course_outline",
	title: "Índice del curso",
	description: "Devuelve los módulos y lecciones de un curso del aula, con su estado de publicación.",
	level: "team",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula"), course_id: id("Curso") }),
	async run({ db }, input) {
		await requireCourseInClassroom(db, input.classroom_id, input.course_id);
		const { data: modules } = await db
			.from("modules")
			.select("id, number, title, is_published")
			.eq("course_id", input.course_id)
			.order("position");
		const moduleRows = (modules ?? []) as { id: string; number: number; title: string; is_published: boolean }[];
		const { data: sessions } = moduleRows.length
			? await db
					.from("sessions")
					.select("id, module_id, number, title, is_published")
					.in(
						"module_id",
						moduleRows.map((mod) => mod.id)
					)
					.order("position")
			: { data: [] };
		const byModule = new Map<string, { session_id: string; number: number; title: string; published: boolean }[]>();
		for (const row of (sessions ?? []) as { id: string; module_id: string; number: number; title: string; is_published: boolean }[]) {
			const list = byModule.get(row.module_id) ?? [];
			list.push({ session_id: row.id, number: row.number, title: row.title, published: row.is_published });
			byModule.set(row.module_id, list);
		}
		return {
			modules: moduleRows.map((mod) => ({
				module_id: mod.id,
				number: mod.number,
				title: mod.title,
				published: mod.is_published,
				lessons: byModule.get(mod.id) ?? []
			}))
		};
	}
});

import { z } from "zod";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { id } from "../domain/sanitize.js";
import { defineTool } from "../mcp/tool.js";
import { classroomCourseIds, requireCourseInClassroom } from "./shared.js";

export const listCourses = defineTool({
	name: "list_courses",
	title: "Cursos del aula",
	description: "Lista los cursos del aula, su categoría, si están publicados y si los puedes editar.",
	level: "team",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula") }),
	async run({ db, actor }, input) {
		const ids = await classroomCourseIds(db, input.classroom_id);
		if (ids.length === 0) return { courses: [] };
		const manages = actor.role === "administrador" || actor.systemAdmin;
		const [{ data }, { data: grants }] = await Promise.all([
			db.from("courses").select("id, title, category, is_published, owner_id").in("id", ids).order("position"),
			manages
				? Promise.resolve({ data: [] })
				: db.from("classroom_course_grants").select("course_id").eq("classroom_id", input.classroom_id).eq("user_id", actor.userId)
		]);
		const granted = new Set(((grants ?? []) as { course_id: string }[]).map((row) => row.course_id));
		const rows = (data ?? []) as { id: string; title: string; category: string | null; is_published: boolean; owner_id: string | null }[];
		return {
			courses: rows.map((course) => ({
				id: course.id,
				title: course.title,
				category: course.category,
				published: course.is_published,
				editable: manages || course.owner_id === actor.userId || granted.has(course.id)
			}))
		};
	}
});

export const getCourseOutline = defineTool({
	name: "get_course_outline",
	title: "Índice del curso",
	description:
		"Módulos y lecciones de un curso con su estado de publicación (shared: módulo compartido de otro curso). depth «modulos» trae solo los módulos; module_id trae las lecciones de un solo módulo.",
	level: "team",
	readOnly: true,
	input: z.object({
		classroom_id: id("Aula"),
		course_id: id("Curso"),
		depth: z.enum(["modulos", "lecciones"]).default("lecciones"),
		module_id: id("Solo este módulo").optional()
	}),
	async run({ db }, input) {
		await requireCourseInClassroom(db, input.classroom_id, input.course_id);
		const [{ data: modules }, { data: linkRows }] = await Promise.all([
			db.from("modules").select("id, number, title, is_published, position").eq("course_id", input.course_id).order("position"),
			db.from("module_courses").select("module_id, position").eq("course_id", input.course_id)
		]);
		type Row = { id: string; number: number; title: string; is_published: boolean; shared?: boolean; position?: number };
		const links = (linkRows ?? []) as { module_id: string; position: number }[];
		const { data: sharedRows } = links.length
			? await db
					.from("modules")
					.select("id, number, title, is_published")
					.in(
						"id",
						links.map((link) => link.module_id)
					)
			: { data: [] };
		const positions = new Map(links.map((link) => [link.module_id, link.position]));
		const moduleRows: Row[] = [
			...((modules ?? []) as Row[]),
			...((sharedRows ?? []) as Row[]).map((row) => ({ ...row, shared: true, position: positions.get(row.id) ?? 0 }))
		]
			.filter((mod) => !input.module_id || mod.id === input.module_id)
			.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
		if (input.module_id && moduleRows.length === 0) throw new ToolError(NOT_FOUND);

		const withLessons = input.depth === "lecciones" || Boolean(input.module_id);
		const { data: sessions } =
			withLessons && moduleRows.length
				? await db
						.from("sessions")
						.select("id, module_id, number, title, is_published")
						.in(
							"module_id",
							moduleRows.map((mod) => mod.id)
						)
						.order("position")
				: { data: [] };
		const byModule = new Map<string, { id: string; n: number; title: string; published: boolean }[]>();
		const counts = new Map<string, number>();
		for (const row of (sessions ?? []) as { id: string; module_id: string; number: number; title: string; is_published: boolean }[]) {
			const list = byModule.get(row.module_id) ?? [];
			list.push({ id: row.id, n: row.number, title: row.title, published: row.is_published });
			byModule.set(row.module_id, list);
			counts.set(row.module_id, (counts.get(row.module_id) ?? 0) + 1);
		}
		return {
			modules: moduleRows.map((mod) => ({
				id: mod.id,
				n: mod.number,
				title: mod.title,
				published: mod.is_published,
				...(mod.shared ? { shared: true } : {}),
				...(withLessons ? { lessons: byModule.get(mod.id) ?? [] } : {})
			}))
		};
	}
});

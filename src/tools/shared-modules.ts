import { z } from "zod";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { id } from "../domain/sanitize.js";
import { defineTool } from "../mcp/tool.js";
import { ownedCourse } from "./ownership.js";
import { classroomCourseIds } from "./shared.js";

const confirm = z.literal(true).describe("Debe ser true: la persona confirmó esta acción");
const MAX_LIBRARIES = 30;
const FAILED = "No pudimos guardar el cambio.";

type Link = { module_id: string; course_id: string; position: number };

async function nextLinkPosition(db: Parameters<typeof ownedCourse>[0], courseId: string) {
	const [own, linked] = await Promise.all([
		db.from("modules").select("position").eq("course_id", courseId).order("position", { ascending: false }).limit(1),
		db.from("module_courses").select("position").eq("course_id", courseId).order("position", { ascending: false }).limit(1)
	]);
	const top = (rows: { data: unknown }) => (rows.data as { position?: number }[] | null)?.[0]?.position ?? 0;
	return Math.max(top(own), top(linked)) + 1;
}

export const listSharedModules = defineTool({
	name: "list_shared_modules",
	title: "Módulos compartidos",
	description:
		"Lista las bibliotecas de módulos que puedes editar (cursos internos donde viven los módulos compartidos) y los módulos compartidos de los cursos del aula, con los cursos donde se usa cada uno. Un módulo compartido se edita una vez y cambia en todos los cursos que lo usan.",
	level: "team",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula") }),
	async run({ db }, input) {
		const roomIds = await classroomCourseIds(db, input.classroom_id);
		const { data: libraryRows } = await db.from("courses").select("id, title, is_published").eq("is_library", true).limit(MAX_LIBRARIES);
		const candidates = (libraryRows ?? []) as { id: string; title: string; is_published: boolean }[];
		const editable = await Promise.all(candidates.map(async (course) => (await db.rpc("can_edit_course", { course: course.id })).data === true));
		const libraries = candidates.filter((_, index) => editable[index]);

		const scope = [...new Set([...libraries.map((library) => library.id), ...roomIds])];
		const { data: moduleRows } = scope.length
			? await db.from("modules").select("id, course_id, number, title, is_published, position").in("course_id", scope).order("position")
			: { data: [] };
		const modules = (moduleRows ?? []) as { id: string; course_id: string; number: number; title: string; is_published: boolean; position: number }[];

		const { data: linkRows } = modules.length
			? await db.from("module_courses").select("module_id, course_id, position").in("module_id", modules.map((row) => row.id))
			: { data: [] };
		const links = (linkRows ?? []) as Link[];

		const titles = new Map<string, string>();
		const wanted = [...new Set([...scope, ...links.map((link) => link.course_id)])];
		if (wanted.length) {
			const { data } = await db.from("courses").select("id, title").in("id", wanted);
			for (const row of (data ?? []) as { id: string; title: string }[]) titles.set(row.id, row.title);
		}

		const libraryIds = new Set(libraries.map((library) => library.id));
		const shared = modules.filter((row) => libraryIds.has(row.course_id) || links.some((link) => link.module_id === row.id));
		const { data: sessionRows } = shared.length
			? await db.from("sessions").select("module_id").in("module_id", shared.map((row) => row.id))
			: { data: [] };
		const lessons = new Map<string, number>();
		for (const row of (sessionRows ?? []) as { module_id: string }[]) lessons.set(row.module_id, (lessons.get(row.module_id) ?? 0) + 1);

		return {
			libraries: libraries.map((library) => ({
				course_id: library.id,
				title: library.title,
				published: library.is_published,
				modules: modules.filter((row) => row.course_id === library.id).length
			})),
			shared_modules: shared.map((row) => ({
				module_id: row.id,
				title: row.title,
				published: row.is_published,
				lessons: lessons.get(row.id) ?? 0,
				host_course_id: row.course_id,
				host_course: titles.get(row.course_id) ?? null,
				in_library: libraryIds.has(row.course_id),
				used_in: links
					.filter((link) => link.module_id === row.id)
					.map((link) => ({ course_id: link.course_id, course: titles.get(link.course_id) ?? null, position: link.position }))
			})),
			linkable_courses: roomIds.filter((courseId) => !libraryIds.has(courseId)).map((courseId) => ({ course_id: courseId, title: titles.get(courseId) ?? null }))
		};
	}
});

export const linkSharedModule = defineTool({
	name: "link_shared_module",
	title: "Usar un módulo en otro curso",
	description:
		"Añade un módulo existente (de una biblioteca o de otro curso que puedes editar) a un curso del aula, sin copiarlo: se edita una vez y cambia en todos. Va al final del curso salvo que indiques posición. Si el módulo está publicado, quien estudia el curso lo verá: confirma antes.",
	level: "team",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		module_id: id("Módulo a compartir"),
		course_id: id("Curso donde se usará"),
		position: z.number().int().min(1).max(10_000).optional().describe("Posición en el curso; por defecto, al final")
	}),
	async run({ db, actor }, input) {
		await ownedCourse(db, actor, input.classroom_id, input.course_id);
		const [{ data: mod }, { data: target }] = await Promise.all([
			db.from("modules").select("course_id").eq("id", input.module_id).maybeSingle(),
			db.from("courses").select("is_library").eq("id", input.course_id).maybeSingle()
		]);
		const hostId = (mod as { course_id: string } | null)?.course_id;
		if (!hostId || !target) throw new ToolError(NOT_FOUND);
		if ((await db.rpc("can_edit_course", { course: hostId })).data !== true) throw new ToolError("No tienes permiso para compartir ese módulo.");
		if (hostId === input.course_id) throw new ToolError("El módulo ya pertenece a ese curso.");
		if ((target as { is_library: boolean }).is_library) throw new ToolError("Una biblioteca guarda módulos, no los usa. Elige un curso normal.");

		const position = input.position ?? (await nextLinkPosition(db, input.course_id));
		const { error } = await db.from("module_courses").insert({ module_id: input.module_id, course_id: input.course_id, position });
		if (error) throw new ToolError(error.code === "23505" ? "Ese curso ya usa este módulo." : FAILED);
		return { linked: true, module_id: input.module_id, course_id: input.course_id, position };
	}
});

export const unlinkSharedModule = defineTool({
	name: "unlink_shared_module",
	title: "Quitar un módulo compartido de un curso",
	description:
		"Quita un módulo compartido de un curso del aula. El módulo no se borra y sigue en sus otros cursos; en este curso deja de verse y se pierde el avance asociado en esa vista. Pide confirmación a la persona.",
	level: "team",
	readOnly: false,
	destructive: true,
	input: z.object({ classroom_id: id("Aula"), module_id: id("Módulo"), course_id: id("Curso"), confirm }),
	async run({ db, actor }, input) {
		await ownedCourse(db, actor, input.classroom_id, input.course_id);
		const { data, error } = await db
			.from("module_courses")
			.delete()
			.eq("module_id", input.module_id)
			.eq("course_id", input.course_id)
			.select("module_id");
		if (error) throw new ToolError(FAILED);
		if (!data?.length) throw new ToolError("Ese curso no usa este módulo.");
		return { unlinked: true, module_id: input.module_id, course_id: input.course_id };
	}
});

export const moveSharedModule = defineTool({
	name: "move_shared_module",
	title: "Cambiar la posición de un módulo compartido",
	description: "Cambia en qué posición aparece un módulo compartido dentro de un curso del aula (no afecta a sus otros cursos).",
	level: "team",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		module_id: id("Módulo"),
		course_id: id("Curso"),
		position: z.number().int().min(1).max(10_000)
	}),
	async run({ db, actor }, input) {
		await ownedCourse(db, actor, input.classroom_id, input.course_id);
		const { data, error } = await db
			.from("module_courses")
			.update({ position: input.position })
			.eq("module_id", input.module_id)
			.eq("course_id", input.course_id)
			.select("module_id");
		if (error) throw new ToolError(FAILED);
		if (!data?.length) throw new ToolError("Ese curso no usa este módulo.");
		return { moved: true, position: input.position };
	}
});

export const setCourseLibrary = defineTool({
	name: "set_course_library",
	title: "Convertir un curso en biblioteca de módulos",
	description:
		"Marca un curso del aula como biblioteca (guarda módulos compartidos y deja de verse en el catálogo) o lo devuelve a curso normal. No se puede si hay conflictos: una biblioteca no puede usar módulos compartidos, y no puede volver a curso mientras otros cursos usen sus módulos. Cambia lo que ve el público: pide confirmación.",
	level: "team",
	readOnly: false,
	input: z.object({ classroom_id: id("Aula"), course_id: id("Curso"), is_library: z.boolean(), confirm }),
	async run({ db, actor }, input) {
		await ownedCourse(db, actor, input.classroom_id, input.course_id);
		if (input.is_library) {
			const { count } = await db.from("module_courses").select("module_id", { count: "exact", head: true }).eq("course_id", input.course_id);
			if ((count ?? 0) > 0) throw new ToolError("Este curso usa módulos compartidos: quítalos antes de convertirlo en biblioteca.");
		} else {
			const { data: own } = await db.from("modules").select("id").eq("course_id", input.course_id);
			const ids = ((own ?? []) as { id: string }[]).map((row) => row.id);
			if (ids.length > 0) {
				const { count } = await db.from("module_courses").select("module_id", { count: "exact", head: true }).in("module_id", ids);
				if ((count ?? 0) > 0) throw new ToolError("Otros cursos usan módulos de esta biblioteca: quítalos de esos cursos primero.");
			}
		}
		const { error } = await db.from("courses").update({ is_library: input.is_library }).eq("id", input.course_id);
		if (error) throw new ToolError(FAILED);
		return { course_id: input.course_id, is_library: input.is_library };
	}
});

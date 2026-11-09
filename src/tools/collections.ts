import { z } from "zod";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { id, isSlug, optionalMarkdown, slugify, text, youtubeUrl } from "../domain/sanitize.js";
import type { Db } from "../domain/supabase.js";
import { defineTool } from "../mcp/tool.js";

const confirm = z.literal(true).describe("Debe ser true: la persona confirmó esta acción irreversible");

async function ownCollection(db: Db, userId: string, collectionId: string) {
	const { data } = await db.from("course_collections").select("id, owner_id").eq("id", collectionId).maybeSingle();
	const row = data as { owner_id: string } | null;
	if (!row) throw new ToolError(NOT_FOUND);
	if (row.owner_id !== userId) throw new ToolError("Solo puedes modificar tus propias colecciones.");
}

async function ownCourse(db: Db, userId: string, courseId: string) {
	const { data } = await db.from("courses").select("owner_id").eq("id", courseId).maybeSingle();
	if (!data) throw new ToolError(NOT_FOUND);
	if ((data as { owner_id: string | null }).owner_id !== userId) throw new ToolError("Solo puedes mover tus propios cursos.");
}

export const listCollections = defineTool({
	name: "list_collections",
	title: "Mis colecciones",
	description: "Lista tus colecciones de cursos con los cursos de cada una.",
	level: "none",
	readOnly: true,
	input: z.object({}),
	async run({ db, actor }) {
		const [{ data: collections }, { data: courses }] = await Promise.all([
			db
				.from("course_collections")
				.select("id, title, slug, description, video_url, is_published, position")
				.eq("owner_id", actor.userId)
				.order("position"),
			db.from("courses").select("id, title, collection_id, position, is_published").eq("owner_id", actor.userId).order("position")
		]);
		const rows = (courses ?? []) as { id: string; title: string; collection_id: string | null; is_published: boolean }[];
		return {
			collections: ((collections ?? []) as { id: string }[]).map(({ id: collectionId, ...rest }) => ({
				collection_id: collectionId,
				...rest,
				courses: rows
					.filter((course) => course.collection_id === collectionId)
					.map((course) => ({ course_id: course.id, title: course.title, published: course.is_published }))
			})),
			loose_courses: rows
				.filter((course) => !course.collection_id)
				.map((course) => ({ course_id: course.id, title: course.title, published: course.is_published }))
		};
	}
});

export const saveCollection = defineTool({
	name: "save_collection",
	title: "Crear o editar una colección",
	description: "Crea una colección de cursos o edita una tuya (envía collection_id). Al editar, envía el título actual si no lo cambias.",
	level: "none",
	readOnly: false,
	input: z.object({
		collection_id: id("Colección a editar").optional(),
		title: text(160, "Título"),
		slug: z.string().optional().describe("Dirección (minúsculas, números y guiones); por defecto sale del título"),
		description: optionalMarkdown(2000, "Descripción"),
		video_url: z.string().max(300).optional().describe("Enlace de YouTube; «» lo quita")
	}),
	async run({ db, actor }, input) {
		const slug = input.slug === undefined ? undefined : slugify(input.slug || input.title, 80);
		if (slug !== undefined && !isSlug(slug)) throw new ToolError("La dirección solo admite letras, números y guiones.");
		let video: string | null | undefined;
		if (input.video_url !== undefined) {
			video = youtubeUrl(input.video_url);
			if (input.video_url.trim() && !video) throw new ToolError("No reconocimos ese enlace de YouTube.");
		}
		const payload = {
			title: input.title,
			description: input.description,
			...(slug !== undefined ? { slug } : {}),
			...(video !== undefined ? { video_url: video } : {})
		};
		const taken = "Ya hay otra colección con esa dirección. Elige otra.";

		if (input.collection_id) {
			await ownCollection(db, actor.userId, input.collection_id);
			const { error } = await db.from("course_collections").update(payload).eq("id", input.collection_id);
			if (error) throw new ToolError(error.code === "23505" ? taken : "No pudimos guardar la colección.");
			return { collection_id: input.collection_id };
		}
		const { count } = await db.from("course_collections").select("id", { count: "exact", head: true });
		const { data, error } = await db
			.from("course_collections")
			.insert({ ...payload, slug: slug ?? slugify(input.title, 80), owner_id: actor.userId, position: (count ?? 0) + 1 })
			.select("id")
			.single();
		if (error || !data) throw new ToolError(error?.code === "23505" ? taken : "No pudimos guardar la colección.");
		return { collection_id: (data as { id: string }).id };
	}
});

export const deleteCollection = defineTool({
	name: "delete_collection",
	title: "Borrar colección",
	description: "Borra una colección tuya. Sus cursos no se borran. Pide confirmación explícita a la persona.",
	level: "none",
	readOnly: false,
	destructive: true,
	input: z.object({ collection_id: id("Colección"), confirm }),
	async run({ db, actor }, input) {
		await ownCollection(db, actor.userId, input.collection_id);
		const { error } = await db.from("course_collections").delete().eq("id", input.collection_id);
		if (error) throw new ToolError("No pudimos borrar la colección.");
		return { deleted: true };
	}
});

export const moveCourseToCollection = defineTool({
	name: "move_course_to_collection",
	title: "Mover un curso de colección",
	description: "Mueve un curso tuyo a una colección tuya, o lo saca de su colección si no envías collection_id.",
	level: "none",
	readOnly: false,
	input: z.object({ course_id: id("Curso"), collection_id: id("Colección de destino").optional() }),
	async run({ db, actor }, input) {
		await ownCourse(db, actor.userId, input.course_id);
		const patch: { collection_id: string | null; position?: number } = { collection_id: input.collection_id ?? null };
		if (input.collection_id) {
			await ownCollection(db, actor.userId, input.collection_id);
			const { data } = await db
				.from("courses")
				.select("position")
				.eq("collection_id", input.collection_id)
				.order("position", { ascending: false })
				.limit(1);
			patch.position = ((data as { position: number }[] | null)?.[0]?.position ?? 0) + 1;
		}
		const { error } = await db.from("courses").update(patch).eq("id", input.course_id);
		if (error) throw new ToolError("No pudimos mover el curso.");
		return { course_id: input.course_id, collection_id: input.collection_id ?? null };
	}
});

export const reorderCollectionCourses = defineTool({
	name: "reorder_collection_courses",
	title: "Ordenar los cursos de una colección",
	description: "Fija el orden de los cursos de una colección tuya. La lista debe incluir todos sus cursos.",
	level: "none",
	readOnly: false,
	input: z.object({ collection_id: id("Colección"), course_ids: z.array(id("Curso")).min(1).max(200) }),
	async run({ db, actor }, input) {
		await ownCollection(db, actor.userId, input.collection_id);
		const { data } = await db.from("courses").select("id").eq("collection_id", input.collection_id).eq("owner_id", actor.userId);
		const existing = new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
		if (
			new Set(input.course_ids).size !== input.course_ids.length ||
			input.course_ids.length !== existing.size ||
			input.course_ids.some((item) => !existing.has(item))
		) {
			throw new ToolError("La lista debe incluir todos los cursos de la colección, sin repetir ni añadir otros.");
		}
		const results = await Promise.all(
			input.course_ids.map((courseId, index) =>
				db
					.from("courses")
					.update({ position: index + 1 })
					.eq("id", courseId)
			)
		);
		if (results.some((result) => result.error)) throw new ToolError("No pudimos guardar el orden.");
		return { reordered: input.course_ids.length };
	}
});

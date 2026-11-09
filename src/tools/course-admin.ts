import { z } from "zod";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { defined, id, isSlug, optionalMarkdown, optionalText, patchMarkdown, patchText, slugWithCode, text } from "../domain/sanitize.js";
import type { Db } from "../domain/supabase.js";
import { ENUMS } from "../limits.js";
import { defineTool } from "../mcp/tool.js";
import { applyOrder, creatorCourse, nextPosition, ownedCourse } from "./ownership.js";

const DIFFICULTY = ENUMS.difficulty;
const VISIBILITY = ENUMS.visibility;
const confirm = z.literal(true).describe("Debe ser true: la persona confirmó esta acción irreversible");

export const createCourse = defineTool({
	name: "create_course",
	title: "Crear curso",
	description:
		"Crea un curso. Queda en borrador y con visibilidad «aula» salvo que se indique otra cosa. Solo si quien llama administra el aula, el curso queda vinculado a ella (igual que en la plataforma); si no, queda sin vincular. Confirma con la persona antes de publicar o hacerlo público.",
	level: "team",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		title: text(200, "Título del curso"),
		subtitle: optionalText(300, "Subtítulo"),
		description: optionalMarkdown(5000, "Descripción"),
		objective: optionalText(1000, "Objetivo"),
		audience: optionalText(1000, "A quién va dirigido"),
		difficulty: z.enum(DIFFICULTY).optional().describe("Nivel; omítelo para no mostrar nivel"),
		visibility: z.enum(VISIBILITY).default("aula").describe("publico (gratis), publico_pago o aula (solo el aula)"),
		collection_id: id("Colección propia").optional(),
		publish: z.boolean().default(false).describe("Publicarlo de inmediato")
	}),
	async run({ db, actor }, input) {
		if (input.collection_id) {
			const { data } = await db.from("course_collections").select("owner_id").eq("id", input.collection_id).maybeSingle();
			if ((data as { owner_id: string } | null)?.owner_id !== actor.userId)
				throw new ToolError("Solo puedes usar tus propias colecciones.");
		}
		const { data: last } = await db.from("courses").select("position").order("position", { ascending: false }).limit(1);
		const position = ((last as { position: number }[] | null)?.[0]?.position ?? 0) + 1;
		const { data, error } = await db
			.from("courses")
			.insert({
				title: input.title,
				slug: slugWithCode(input.title),
				subtitle: input.subtitle,
				description: input.description,
				objective: input.objective,
				audience: input.audience,
				difficulty: input.difficulty ?? null,
				visibility: input.visibility,
				collection_id: input.collection_id ?? null,
				is_published: input.publish,
				owner_id: actor.userId,
				position
			})
			.select("id")
			.single();
		if (error || !data) throw new ToolError("No pudimos crear el curso.");
		const courseId = (data as { id: string }).id;

		let linked = false;
		if (actor.role === "administrador") {
			const { data: rows } = await db
				.from("classroom_courses")
				.select("position")
				.eq("classroom_id", input.classroom_id)
				.order("position", { ascending: false })
				.limit(1);
			const next = ((rows as { position: number }[] | null)?.[0]?.position ?? 0) + 1;
			const { error: linkError } = await db
				.from("classroom_courses")
				.upsert({ classroom_id: input.classroom_id, course_id: courseId, position: next }, { onConflict: "classroom_id,course_id" });
			linked = !linkError;
		}
		return { course_id: courseId, published: input.publish, linked_to_classroom: linked };
	}
});

export const getCourse = defineTool({
	name: "get_course",
	title: "Detalle del curso",
	description: "Devuelve los datos editables de un curso del aula: títulos, descripción, nivel, visibilidad, colección y publicación.",
	level: "team",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula"), course_id: id("Curso") }),
	async run({ db, actor }, input) {
		await ownedCourse(db, actor, input.classroom_id, input.course_id);
		const { data } = await db
			.from("courses")
			.select(
				"id, title, subtitle, slug, description, objective, audience, difficulty, visibility, collection_id, is_published, position, owner_id"
			)
			.eq("id", input.course_id)
			.maybeSingle();
		if (!data) throw new ToolError(NOT_FOUND);
		const course = data as Record<string, unknown>;
		return { ...course, is_owner: course.owner_id === actor.userId, owner_id: undefined };
	}
});

export const updateCourse = defineTool({
	name: "update_course",
	title: "Editar curso",
	description:
		"Cambia los datos de un curso que puedes editar. Solo se modifica lo que envíes. Confirma con la persona antes de publicar o cambiar la visibilidad.",
	level: "team",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		course_id: id("Curso"),
		title: z
			.string()
			.optional()
			.describe("Título")
			.transform((value) => (value === undefined ? undefined : value.trim().slice(0, 200)))
			.pipe(z.string().min(1).optional()),
		subtitle: patchText(300, "Subtítulo"),
		description: patchMarkdown(5000, "Descripción"),
		objective: patchText(1000, "Objetivo"),
		audience: patchText(1000, "A quién va dirigido"),
		difficulty: z
			.enum([...DIFFICULTY, "ninguno"])
			.optional()
			.describe("Nivel; «ninguno» lo quita"),
		visibility: z.enum(VISIBILITY).optional(),
		slug: z.string().optional().describe("Dirección del curso (minúsculas, números y guiones)"),
		position: z.number().int().min(1).max(10_000).optional(),
		published: z.boolean().optional().describe("true publica, false pasa a borrador")
	}),
	async run({ db, actor }, input) {
		await ownedCourse(db, actor, input.classroom_id, input.course_id);
		if (input.slug !== undefined && !isSlug(input.slug)) throw new ToolError("La dirección solo admite minúsculas, números y guiones.");
		const patch = defined({
			title: input.title,
			subtitle: input.subtitle,
			description: input.description,
			objective: input.objective,
			audience: input.audience,
			difficulty: input.difficulty === undefined ? undefined : input.difficulty === "ninguno" ? null : input.difficulty,
			visibility: input.visibility,
			slug: input.slug,
			position: input.position,
			is_published: input.published
		});
		if (Object.keys(patch).length === 0) throw new ToolError("No indicaste nada que cambiar.");
		const { error } = await db.from("courses").update(patch).eq("id", input.course_id);
		if (error) throw new ToolError(error.code === "23505" ? "Ese identificador ya lo usa otro curso." : "No pudimos guardar el curso.");
		return { course_id: input.course_id, updated: Object.keys(patch) };
	}
});

export const deleteCourse = defineTool({
	name: "delete_course",
	title: "Borrar curso",
	description:
		"Borra definitivamente un curso con todos sus módulos, lecciones y evaluaciones. Solo quien lo creó. Irreversible: pide confirmación explícita a la persona.",
	level: "team",
	readOnly: false,
	destructive: true,
	input: z.object({ classroom_id: id("Aula"), course_id: id("Curso"), confirm }),
	async run({ db, actor }, input) {
		await creatorCourse(db, actor, input.classroom_id, input.course_id);
		const { error } = await db.from("courses").delete().eq("id", input.course_id);
		if (error) throw new ToolError("No pudimos borrar el curso.");
		return { deleted: true, course_id: input.course_id };
	}
});

export const transferCourse = defineTool({
	name: "transfer_course",
	title: "Transferir curso",
	description: "Transfiere la propiedad de un curso a otro docente. Solo quien lo creó. Pide confirmación explícita antes de hacerlo.",
	level: "team",
	readOnly: false,
	destructive: true,
	input: z.object({ classroom_id: id("Aula"), course_id: id("Curso"), new_owner_id: id("Docente de destino"), confirm }),
	async run({ db, actor }, input) {
		await creatorCourse(db, actor, input.classroom_id, input.course_id);
		if (input.new_owner_id === actor.userId) throw new ToolError("Esa persona ya es la propietaria del curso.");
		const { data } = await db.from("profiles").select("role").eq("id", input.new_owner_id).maybeSingle();
		const role = (data as { role?: string } | null)?.role;
		if (role !== "profesor" && role !== "admin") throw new ToolError("El destino debe ser un docente o administrador.");

		const { error } = await db.rpc("transfer_course", { course_id: input.course_id, new_owner_id: input.new_owner_id });
		if (error) {
			const { error: updateError } = await db
				.from("courses")
				.update({ owner_id: input.new_owner_id, updated_at: new Date().toISOString() })
				.eq("id", input.course_id);
			if (updateError) throw new ToolError("No pudimos transferir el curso.");
		}
		return { course_id: input.course_id, new_owner_id: input.new_owner_id };
	}
});

export const reorderModules = defineTool({
	name: "reorder_modules",
	title: "Ordenar módulos",
	description: "Fija el orden de los módulos de un curso. La lista debe incluir todos los módulos del curso, en el orden deseado.",
	level: "team",
	readOnly: false,
	input: z.object({ classroom_id: id("Aula"), course_id: id("Curso"), module_ids: z.array(id("Módulo")).min(1).max(200) }),
	async run({ db, actor }, input) {
		await ownedCourse(db, actor, input.classroom_id, input.course_id);
		await applyOrder(db, "modules", "course_id", input.course_id, input.module_ids);
		return { reordered: input.module_ids.length };
	}
});

type ThemeRow = { id: string; title: string; description: string | null; position: number };

export const listCourseThemes = defineTool({
	name: "list_course_themes",
	title: "Temas del curso",
	description: "Lista los temas de un curso con sus prerrequisitos.",
	level: "team",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula"), course_id: id("Curso") }),
	async run({ db, actor }, input) {
		await ownedCourse(db, actor, input.classroom_id, input.course_id);
		const { data } = await db
			.from("course_themes")
			.select("id, title, description, position")
			.eq("course_id", input.course_id)
			.order("position");
		const themes = (data ?? []) as ThemeRow[];
		const { data: links } = themes.length
			? await db
					.from("theme_prerequisites")
					.select("theme_id, prerequisite_id")
					.in(
						"theme_id",
						themes.map((theme) => theme.id)
					)
			: { data: [] };
		const requires = new Map<string, string[]>();
		for (const row of (links ?? []) as { theme_id: string; prerequisite_id: string }[])
			requires.set(row.theme_id, [...(requires.get(row.theme_id) ?? []), row.prerequisite_id]);
		return {
			themes: themes.map((theme) => ({
				theme_id: theme.id,
				title: theme.title,
				description: theme.description,
				position: theme.position,
				prerequisite_ids: requires.get(theme.id) ?? []
			}))
		};
	}
});

export const saveTheme = defineTool({
	name: "save_theme",
	title: "Crear o editar un tema",
	description:
		"Crea un tema del curso o edita uno existente (envía theme_id). Si envías prerequisite_ids, reemplaza los prerrequisitos; deben ser temas del mismo curso.",
	level: "team",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		course_id: id("Curso"),
		theme_id: id("Tema a editar").optional(),
		title: text(160, "Nombre del tema"),
		description: optionalText(1000, "Descripción"),
		position: z.number().int().min(1).max(500).optional(),
		prerequisite_ids: z.array(id("Tema prerrequisito")).max(50).optional()
	}),
	async run({ db, actor }, input) {
		await ownedCourse(db, actor, input.classroom_id, input.course_id);
		const payload = {
			course_id: input.course_id,
			title: input.title,
			description: input.description,
			position: input.position ?? (input.theme_id ? undefined : await nextPosition(db, "course_themes", "course_id", input.course_id))
		};
		let themeId = input.theme_id;
		if (themeId) {
			const { data: existing } = await db.from("course_themes").select("course_id").eq("id", themeId).maybeSingle();
			if ((existing as { course_id: string } | null)?.course_id !== input.course_id) throw new ToolError(NOT_FOUND);
			const { error } = await db.from("course_themes").update(defined(payload)).eq("id", themeId);
			if (error) throw new ToolError("No pudimos guardar el tema.");
		} else {
			const { data, error } = await db.from("course_themes").insert(defined(payload)).select("id").single();
			if (error || !data) throw new ToolError("No pudimos guardar el tema.");
			themeId = (data as { id: string }).id;
		}
		if (input.prerequisite_ids) {
			const wanted = [...new Set(input.prerequisite_ids.filter((item) => item !== themeId))];
			const { error: clearError } = await db.from("theme_prerequisites").delete().eq("theme_id", themeId);
			if (clearError) throw new ToolError("No pudimos guardar los prerrequisitos.");
			if (wanted.length > 0) {
				const { error } = await db
					.from("theme_prerequisites")
					.insert(wanted.map((prerequisite_id) => ({ theme_id: themeId, prerequisite_id })));
				if (error) throw new ToolError("Los prerrequisitos deben ser temas del mismo curso.");
			}
		}
		return { theme_id: themeId };
	}
});

export const deleteTheme = defineTool({
	name: "delete_theme",
	title: "Borrar tema",
	description: "Borra un tema del curso. Los materiales dejan de estar asociados a él.",
	level: "team",
	readOnly: false,
	destructive: true,
	input: z.object({ classroom_id: id("Aula"), theme_id: id("Tema") }),
	async run({ db, actor }, input) {
		const { data } = await db.from("course_themes").select("course_id").eq("id", input.theme_id).maybeSingle();
		const courseId = (data as { course_id: string } | null)?.course_id;
		if (!courseId) throw new ToolError(NOT_FOUND);
		await ownedCourse(db, actor, input.classroom_id, courseId);
		const { error } = await db.from("course_themes").delete().eq("id", input.theme_id);
		if (error) throw new ToolError("No pudimos borrar el tema.");
		return { deleted: true };
	}
});

const THEME_KINDS = ["sesion", "pregunta_quiz", "pregunta_examen", "tarjeta", "juego", "escenario"] as const;
type ThemeKind = (typeof THEME_KINDS)[number];

async function parentOf(db: Db, table: string, column: string, rowId: string | null) {
	if (!rowId) return null;
	const { data } = await db.from(table).select(column).eq("id", rowId).maybeSingle();
	return ((data as unknown as Record<string, string | null> | null)?.[column] ?? null) as string | null;
}

async function courseOfItem(db: Db, kind: ThemeKind, ref: string) {
	const viaModule = (moduleId: string | null) => parentOf(db, "modules", "course_id", moduleId);
	const viaSession = async (sessionId: string | null) => viaModule(await parentOf(db, "sessions", "module_id", sessionId));
	switch (kind) {
		case "sesion":
			return viaModule(await parentOf(db, "sessions", "module_id", ref));
		case "pregunta_quiz":
			return viaSession(await parentOf(db, "quiz_questions", "session_id", ref));
		case "pregunta_examen":
			return viaModule(await parentOf(db, "exams", "module_id", await parentOf(db, "exam_questions", "exam_id", ref)));
		case "tarjeta":
			return parentOf(db, "flashcards", "course_id", ref);
		case "juego":
			return viaSession(await parentOf(db, "interactive_activities", "session_id", ref));
		case "escenario":
			return viaModule(await parentOf(db, "scenarios", "module_id", ref));
	}
}

export const setItemThemes = defineTool({
	name: "set_item_themes",
	title: "Asociar temas a un material",
	description:
		"Fija a qué temas del curso pertenece una lección, pregunta de quiz o de examen, tarjeta, juego o escenario. Reemplaza las asociaciones previas.",
	level: "team",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		kind: z.enum(THEME_KINDS).describe("sesion (lección), pregunta_quiz, pregunta_examen, tarjeta, juego o escenario"),
		item_id: id("Material"),
		theme_ids: z.array(id("Tema")).max(50).describe("Lista vacía para quitar todos los temas")
	}),
	async run({ db, actor }, input) {
		const courseId = await courseOfItem(db, input.kind, input.item_id);
		if (!courseId) throw new ToolError(NOT_FOUND);
		await ownedCourse(db, actor, input.classroom_id, courseId);
		const wanted = [...new Set(input.theme_ids)];
		const { data: courseThemes } = await db.from("course_themes").select("id").eq("course_id", courseId);
		const all = ((courseThemes ?? []) as { id: string }[]).map((row) => row.id);
		if (wanted.some((item) => !all.includes(item))) throw new ToolError("Alguno de los temas no pertenece a este curso.");
		if (all.length > 0) {
			const { error } = await db.from("theme_links").delete().eq("kind", input.kind).eq("ref_id", input.item_id).in("theme_id", all);
			if (error) throw new ToolError("No pudimos guardar los temas.");
		}
		if (wanted.length > 0) {
			const { error } = await db
				.from("theme_links")
				.insert(wanted.map((theme_id) => ({ theme_id, kind: input.kind, ref_id: input.item_id })));
			if (error) throw new ToolError("No pudimos guardar los temas.");
		}
		return { item_id: input.item_id, theme_ids: wanted };
	}
});

import { z } from "zod";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { defined, id, patchMarkdown, patchText, text, youtubeUrl } from "../domain/sanitize.js";
import { ENUMS } from "../limits.js";
import { defineTool } from "../mcp/tool.js";
import { applyOrder, ownedModule, ownedSession } from "./ownership.js";

const confirm = z.literal(true).describe("Debe ser true: la persona confirmó esta acción irreversible");
const KINDS = ENUMS.moduleKind;
const FORMATS = ENUMS.sessionFormat;

export const getModule = defineTool({
	name: "get_module",
	title: "Detalle del módulo",
	description: "Devuelve los datos editables de un módulo y sus evaluaciones (exámenes y escenarios).",
	level: "team",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula"), module_id: id("Módulo") }),
	async run({ db, actor }, input) {
		await ownedModule(db, actor, input.classroom_id, input.module_id);
		const [{ data: mod }, { data: exams }, { data: scenarios }] = await Promise.all([
			db
				.from("modules")
				.select("id, course_id, title, kind, objective, description, is_published, is_locked, opens_at, position")
				.eq("id", input.module_id)
				.maybeSingle(),
			db.from("exams").select("id, title, is_published").eq("module_id", input.module_id),
			db.from("scenarios").select("id, title, is_published").eq("module_id", input.module_id)
		]);
		if (!mod) throw new ToolError(NOT_FOUND);
		return {
			...(mod as Record<string, unknown>),
			exams: ((exams ?? []) as { id: string; title: string; is_published: boolean }[]).map((row) => ({
				exam_id: row.id,
				title: row.title,
				published: row.is_published
			})),
			scenarios: ((scenarios ?? []) as { id: string; title: string; is_published: boolean }[]).map((row) => ({
				scenario_id: row.id,
				title: row.title,
				published: row.is_published
			}))
		};
	}
});

export const updateModule = defineTool({
	name: "update_module",
	title: "Editar módulo",
	description:
		"Cambia los datos de un módulo de un curso que puedes editar. Solo se modifica lo que envíes. Confirma con la persona antes de publicar.",
	level: "team",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		module_id: id("Módulo"),
		title: z
			.string()
			.optional()
			.describe("Título")
			.transform((value) => (value === undefined ? undefined : value.trim().slice(0, 200)))
			.pipe(z.string().min(1).optional()),
		objective: patchText(1000, "Objetivo"),
		description: patchMarkdown(20_000, "Descripción"),
		kind: z.enum(KINDS).optional(),
		published: z.boolean().optional(),
		locked: z.boolean().optional().describe("Bloqueado hasta que se abra manualmente"),
		opens_at: z
			.union([z.iso.datetime({ offset: true }), z.literal("")])
			.optional()
			.describe("Fecha de apertura en ISO 8601; «» la quita"),
		position: z.number().int().min(1).max(10_000).optional()
	}),
	async run({ db, actor }, input) {
		await ownedModule(db, actor, input.classroom_id, input.module_id);
		const patch = defined({
			title: input.title,
			objective: input.objective,
			description: input.description,
			kind: input.kind,
			is_published: input.published,
			is_locked: input.locked,
			opens_at: input.opens_at === undefined ? undefined : input.opens_at === "" ? null : new Date(input.opens_at).toISOString(),
			position: input.position
		});
		if (Object.keys(patch).length === 0) throw new ToolError("No indicaste nada que cambiar.");
		const { error } = await db.from("modules").update(patch).eq("id", input.module_id);
		if (error) throw new ToolError("No pudimos guardar el módulo.");
		return { module_id: input.module_id, updated: Object.keys(patch) };
	}
});

export const deleteModule = defineTool({
	name: "delete_module",
	title: "Borrar módulo",
	description: "Borra definitivamente un módulo con sus lecciones y evaluaciones. Irreversible: pide confirmación explícita a la persona.",
	level: "team",
	readOnly: false,
	destructive: true,
	input: z.object({ classroom_id: id("Aula"), module_id: id("Módulo"), confirm }),
	async run({ db, actor }, input) {
		await ownedModule(db, actor, input.classroom_id, input.module_id);
		const { error } = await db.from("modules").delete().eq("id", input.module_id);
		if (error) throw new ToolError("No pudimos borrar el módulo.");
		return { deleted: true, module_id: input.module_id };
	}
});

export const reorderLessons = defineTool({
	name: "reorder_lessons",
	title: "Ordenar lecciones",
	description: "Fija el orden de las lecciones de un módulo. La lista debe incluir todas las lecciones del módulo, en el orden deseado.",
	level: "team",
	readOnly: false,
	input: z.object({ classroom_id: id("Aula"), module_id: id("Módulo"), session_ids: z.array(id("Lección")).min(1).max(500) }),
	async run({ db, actor }, input) {
		await ownedModule(db, actor, input.classroom_id, input.module_id);
		await applyOrder(db, "sessions", "module_id", input.module_id, input.session_ids);
		return { reordered: input.session_ids.length };
	}
});

export const getLesson = defineTool({
	name: "get_lesson",
	title: "Detalle de la lección",
	description:
		"Devuelve el contenido completo de una lección (resumen, objetivos, texto, vídeo, formato) y cuántos quizzes, tarjetas y juegos tiene.",
	level: "team",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula"), session_id: id("Lección") }),
	async run({ db, actor }, input) {
		await ownedSession(db, actor, input.classroom_id, input.session_id);
		const count = async (table: string) =>
			(await db.from(table).select("id", { count: "exact", head: true }).eq("session_id", input.session_id)).count ?? 0;
		const [{ data }, quiz, self, cards, games] = await Promise.all([
			db
				.from("sessions")
				.select("id, module_id, title, summary, objectives, content, key_idea, format, video_url, is_published, position")
				.eq("id", input.session_id)
				.maybeSingle(),
			count("quiz_questions"),
			count("session_questions"),
			count("flashcards"),
			count("interactive_activities")
		]);
		if (!data) throw new ToolError(NOT_FOUND);
		return { ...(data as Record<string, unknown>), quiz_questions: quiz, self_check_questions: self, flashcards: cards, games };
	}
});

export const updateLesson = defineTool({
	name: "update_lesson",
	title: "Editar lección",
	description:
		"Cambia los datos de una lección de un curso que puedes editar. Solo se modifica lo que envíes. Confirma con la persona antes de publicar.",
	level: "team",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		session_id: id("Lección"),
		title: z
			.string()
			.optional()
			.describe("Título")
			.transform((value) => (value === undefined ? undefined : value.trim().slice(0, 200)))
			.pipe(z.string().min(1).optional()),
		summary: patchText(600, "Resumen"),
		content: patchMarkdown(60_000, "Contenido en Markdown"),
		key_idea: patchText(400, "Idea clave"),
		objectives: z.array(text(300, "Objetivo")).max(20).optional().describe("Reemplaza la lista de objetivos"),
		format: z.enum(FORMATS).optional(),
		video_url: z.string().max(300).optional().describe("Enlace de YouTube; «» lo quita"),
		published: z.boolean().optional(),
		position: z.number().int().min(1).max(10_000).optional()
	}),
	async run({ db, actor }, input) {
		await ownedSession(db, actor, input.classroom_id, input.session_id);
		let video: string | null | undefined;
		if (input.video_url !== undefined) {
			video = youtubeUrl(input.video_url);
			if (input.video_url.trim() && !video) throw new ToolError("No reconocimos ese enlace de YouTube.");
		}
		const patch = defined({
			title: input.title,
			summary: input.summary,
			content: input.content,
			key_idea: input.key_idea,
			objectives: input.objectives,
			format: input.format,
			video_url: video,
			is_published: input.published,
			position: input.position
		});
		if (Object.keys(patch).length === 0) throw new ToolError("No indicaste nada que cambiar.");
		const { error } = await db.from("sessions").update(patch).eq("id", input.session_id);
		if (error) throw new ToolError("No pudimos guardar la lección.");
		return { session_id: input.session_id, updated: Object.keys(patch) };
	}
});

export const deleteLesson = defineTool({
	name: "delete_lesson",
	title: "Borrar lección",
	description: "Borra definitivamente una lección con su quiz, tarjetas y juegos. Irreversible: pide confirmación explícita a la persona.",
	level: "team",
	readOnly: false,
	destructive: true,
	input: z.object({ classroom_id: id("Aula"), session_id: id("Lección"), confirm }),
	async run({ db, actor }, input) {
		await ownedSession(db, actor, input.classroom_id, input.session_id);
		const { error } = await db.from("sessions").delete().eq("id", input.session_id);
		if (error) throw new ToolError("No pudimos borrar la lección.");
		return { deleted: true, session_id: input.session_id };
	}
});

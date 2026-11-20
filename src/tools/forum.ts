import { z } from "zod";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { platformOf } from "../domain/platform.js";
import { id, markdown } from "../domain/sanitize.js";
import { UNTRUSTED_NOTE } from "../limits.js";
import { defineTool } from "../mcp/tool.js";
import { profileNames } from "./shared.js";

type Topic = {
	id: string;
	title: string;
	is_published: boolean;
	is_pinned: boolean;
	is_locked: boolean;
	opens_at: string | null;
	closes_at: string | null;
	created_at: string;
};

const when = z.iso.datetime({ offset: true });

function platformNote(classroomId: string) {
	return platformOf(classroomId).hidden.includes("foro") ? { warning: "Esta plataforma no muestra el foro a los estudiantes." } : {};
}

export const listForumTopics = defineTool({
	name: "list_forum_topics",
	title: "Temas del foro del aula",
	description: "Temas del foro del aula (módulo Foro, no las lecciones) con estado, fechas y número de respuestas.",
	level: "team",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula"), limit: z.number().int().min(1).max(200).default(30) }),
	async run({ db }, input) {
		const { data } = await db
			.from("classroom_posts")
			.select("id, title, is_published, is_pinned, is_locked, opens_at, closes_at, created_at")
			.eq("classroom_id", input.classroom_id)
			.order("is_pinned", { ascending: false })
			.order("created_at", { ascending: false })
			.limit(input.limit);
		const topics = (data ?? []) as Topic[];
		const { data: replies } = topics.length
			? await db
					.from("classroom_replies")
					.select("post_id")
					.in(
						"post_id",
						topics.map((topic) => topic.id)
					)
			: { data: [] };
		const counts = new Map<string, number>();
		for (const row of (replies ?? []) as { post_id: string }[]) counts.set(row.post_id, (counts.get(row.post_id) ?? 0) + 1);
		return {
			...platformNote(input.classroom_id),
			total: topics.length,
			topics: topics.map((topic) => ({
				id: topic.id,
				title: topic.title,
				published: topic.is_published,
				pinned: topic.is_pinned,
				locked: topic.is_locked,
				opens: topic.opens_at?.slice(0, 16) ?? null,
				closes: topic.closes_at?.slice(0, 16) ?? null,
				replies: counts.get(topic.id) ?? 0
			}))
		};
	}
});

export const getForumTopic = defineTool({
	name: "get_forum_topic",
	title: "Tema del foro con sus respuestas",
	description: "Mensaje de apertura y respuestas de un tema del foro (las más recientes primero, paginadas).",
	level: "team",
	readOnly: true,
	input: z.object({
		classroom_id: id("Aula"),
		topic_id: id("Tema"),
		offset: z.number().int().min(0).max(10_000).default(0),
		limit: z.number().int().min(1).max(100).default(30)
	}),
	async run({ db }, input) {
		const [{ data: topic }, { data: replies, count }] = await Promise.all([
			db
				.from("classroom_posts")
				.select("title, body, is_locked, user_id")
				.eq("id", input.topic_id)
				.eq("classroom_id", input.classroom_id)
				.maybeSingle(),
			db
				.from("classroom_replies")
				.select("id, user_id, body, parent_id, created_at", { count: "exact" })
				.eq("post_id", input.topic_id)
				.order("created_at", { ascending: false })
				.range(input.offset, input.offset + input.limit - 1)
		]);
		if (!topic) throw new ToolError(NOT_FOUND);
		const rows = (replies ?? []) as { id: string; user_id: string; body: string; parent_id: string | null; created_at: string }[];
		const names = await profileNames(db, [...new Set(rows.map((row) => row.user_id))]);
		const total = count ?? rows.length;
		return {
			note: UNTRUSTED_NOTE,
			title: (topic as { title: string }).title,
			body: (topic as { body: string }).body,
			locked: (topic as { is_locked: boolean }).is_locked,
			total_replies: total,
			...(input.offset + rows.length < total ? { next_offset: input.offset + rows.length } : {}),
			replies: rows.map((row) => ({
				id: row.id,
				author: names.get(row.user_id) ?? "Sin nombre",
				at: row.created_at.slice(0, 16),
				reply_to: row.parent_id,
				text: row.body.slice(0, 1500)
			}))
		};
	}
});

export const saveForumTopic = defineTool({
	name: "save_forum_topic",
	title: "Crear o moderar un tema del foro",
	description:
		"Crea un tema en el foro del aula (title y body obligatorios; queda en borrador salvo published=true) o, con topic_id, cambia solo lo que envíes: título, mensaje, fijado, bloqueado (cierra respuestas), publicado, apertura y cierre (fechas ISO; open_now=true lo abre ya y quita el cierre). Confirma antes de publicar.",
	level: "team",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		topic_id: id("Tema a editar").optional(),
		title: z.string().trim().min(1).max(200).optional(),
		body: markdown(8000, "Mensaje de apertura").optional(),
		pinned: z.boolean().optional(),
		locked: z.boolean().optional(),
		published: z.boolean().optional(),
		opens_at: when.optional(),
		closes_at: when.optional(),
		open_now: z.boolean().optional()
	}),
	async run({ db, actor }, input) {
		const opens = input.open_now ? null : input.opens_at ? new Date(input.opens_at).toISOString() : undefined;
		const closes = input.open_now ? null : input.closes_at ? new Date(input.closes_at).toISOString() : undefined;
		if (opens && closes && new Date(closes) <= new Date(opens)) throw new ToolError("El cierre tiene que ser posterior a la apertura.");
		const patch = Object.fromEntries(
			Object.entries({
				title: input.title,
				body: input.body,
				is_pinned: input.pinned,
				is_locked: input.open_now ? false : input.locked,
				is_published: input.published,
				opens_at: opens,
				closes_at: closes
			}).filter(([, value]) => value !== undefined)
		);

		if (input.topic_id) {
			if (Object.keys(patch).length === 0) throw new ToolError("No indicaste nada que cambiar.");
			const { data, error } = await db
				.from("classroom_posts")
				.update(patch)
				.eq("id", input.topic_id)
				.eq("classroom_id", input.classroom_id)
				.select("id")
				.maybeSingle();
			if (error || !data) throw new ToolError(error ? "No pudimos guardar el tema." : NOT_FOUND);
			return { topic_id: input.topic_id, updated: Object.keys(patch), ...platformNote(input.classroom_id) };
		}

		if (!input.title || !input.body) throw new ToolError("Un tema nuevo necesita title y body.");
		const { data, error } = await db
			.from("classroom_posts")
			.insert({
				is_pinned: false,
				is_published: false,
				is_locked: false,
				...patch,
				classroom_id: input.classroom_id,
				user_id: actor.userId
			})
			.select("id")
			.single();
		if (error || !data) throw new ToolError("No pudimos crear el tema.", "Revisa que el foro esté activo en el aula (get_classroom).");
		return { topic_id: (data as { id: string }).id, published: patch.is_published === true, ...platformNote(input.classroom_id) };
	}
});

export const replyForum = defineTool({
	name: "reply_forum",
	title: "Responder en el foro",
	description:
		"Publica una respuesta tuya en un tema del foro (opcionalmente en respuesta a otra con reply_to). Muestra el texto a la persona y pide confirmación antes de enviarlo.",
	level: "team",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		topic_id: id("Tema"),
		text: markdown(2000, "Respuesta"),
		reply_to: id("Respuesta a la que contestas").optional()
	}),
	async run({ db, actor }, input) {
		const { data: topic } = await db
			.from("classroom_posts")
			.select("id")
			.eq("id", input.topic_id)
			.eq("classroom_id", input.classroom_id)
			.maybeSingle();
		if (!topic) throw new ToolError(NOT_FOUND);
		const { data, error } = await db
			.from("classroom_replies")
			.insert({
				post_id: input.topic_id,
				user_id: actor.userId,
				body: input.text,
				...(input.reply_to ? { parent_id: input.reply_to } : {})
			})
			.select("id")
			.single();
		if (error || !data) throw new ToolError("No pudimos publicar la respuesta.", "Puede que el tema esté cerrado.");
		return { reply_id: (data as { id: string }).id };
	}
});

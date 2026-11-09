import { z } from "zod";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { id } from "../domain/sanitize.js";
import { LIMITS } from "../limits.js";
import { defineTool } from "../mcp/tool.js";
import { classroomCourseIds, daysSince, profileNames } from "./shared.js";

const confirm = z.literal(true).describe("Debe ser true: la persona confirmó esta acción irreversible");

type Member = {
	id: string;
	user_id: string;
	status: string;
	access: string | null;
	trial_course_id: string | null;
	requested_at: string;
	decided_at: string | null;
};

export const listMembers = defineTool({
	name: "list_members",
	title: "Personas del aula",
	description:
		"Lista a las personas del aula con su estado (pendiente, aprobado o rechazado), tipo de acceso, curso elegido y cursos activados. Sin correos ni teléfonos.",
	level: "team",
	readOnly: true,
	input: z.object({
		classroom_id: id("Aula"),
		status: z.enum(["pendiente", "aprobado", "rechazado"]).optional().describe("Filtra por estado"),
		limit: z.number().int().min(1).max(LIMITS.pageMax).default(LIMITS.pageDefault),
		offset: z.number().int().min(0).max(100_000).default(0).describe("Para pasar a la página siguiente")
	}),
	async run({ db }, input) {
		let query = db
			.from("classroom_members")
			.select("id, user_id, status, access, trial_course_id, requested_at, decided_at", { count: "exact" })
			.eq("classroom_id", input.classroom_id);
		if (input.status) query = query.eq("status", input.status);
		const { data, count } = await query.order("requested_at", { ascending: false }).range(input.offset, input.offset + input.limit - 1);
		const members = (data ?? []) as Member[];
		const { data: grants } = members.length
			? await db
					.from("classroom_course_grants")
					.select("user_id, course_id")
					.eq("classroom_id", input.classroom_id)
					.in(
						"user_id",
						members.map((member) => member.user_id)
					)
			: { data: [] };
		const granted = new Map<string, string[]>();
		for (const row of (grants ?? []) as { user_id: string; course_id: string }[])
			granted.set(row.user_id, [...(granted.get(row.user_id) ?? []), row.course_id]);
		const names = await profileNames(
			db,
			members.map((member) => member.user_id)
		);
		return {
			total: count ?? members.length,
			next_offset: input.offset + members.length < (count ?? 0) ? input.offset + members.length : null,
			members: members.map((member) => ({
				member_id: member.id,
				user_id: member.user_id,
				name: names.get(member.user_id) ?? "Sin nombre",
				status: member.status,
				access: member.access,
				chosen_course_id: member.trial_course_id,
				granted_course_ids: granted.get(member.user_id) ?? [],
				requested_at: member.requested_at,
				decided_at: member.decided_at
			}))
		};
	}
});

type SessionProgress = {
	session_id: string;
	status: string;
	completed_at: string | null;
	quiz_score: number | null;
	quiz_total: number | null;
	attempts: number;
};

export const getStudentDetail = defineTool({
	name: "get_student_detail",
	title: "Avance de un estudiante",
	description: "Muestra el avance lección por lección de un estudiante del aula, agrupado por módulo, con puntajes de quiz e intentos.",
	level: "team",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula"), user_id: id("Estudiante") }),
	async run({ db }, input) {
		const { data: member } = await db
			.from("classroom_members")
			.select("id")
			.eq("classroom_id", input.classroom_id)
			.eq("user_id", input.user_id)
			.maybeSingle();
		if (!member) throw new ToolError(NOT_FOUND);
		const [{ data: progress }, { data: summaries }, names] = await Promise.all([
			db.rpc("classroom_student_sessions", { room: input.classroom_id, person: input.user_id }),
			db.rpc("classroom_student_summary", { room: input.classroom_id }),
			profileNames(db, [input.user_id])
		]);
		const rows = (progress ?? []) as SessionProgress[];
		const { data: sessions } = rows.length
			? await db
					.from("sessions")
					.select("id, title, module_id")
					.in(
						"id",
						rows.map((row) => row.session_id)
					)
			: { data: [] };
		const sessionRows = (sessions ?? []) as { id: string; title: string; module_id: string }[];
		const { data: modules } = sessionRows.length
			? await db
					.from("modules")
					.select("id, title")
					.in("id", [...new Set(sessionRows.map((row) => row.module_id))])
			: { data: [] };
		const moduleTitle = new Map(((modules ?? []) as { id: string; title: string }[]).map((row) => [row.id, row.title]));
		const sessionInfo = new Map(sessionRows.map((row) => [row.id, row]));

		const grouped = new Map<string, { module: string; lessons: unknown[] }>();
		for (const row of rows) {
			const info = sessionInfo.get(row.session_id);
			const title = info ? (moduleTitle.get(info.module_id) ?? "Sin módulo") : "Sin módulo";
			const group = grouped.get(title) ?? { module: title, lessons: [] };
			group.lessons.push({
				title: info?.title ?? "Lección",
				status: row.status,
				completed_at: row.completed_at,
				quiz_score: row.quiz_score,
				quiz_total: row.quiz_total,
				attempts: row.attempts
			});
			grouped.set(title, group);
		}
		const done = rows.filter((row) => row.status === "completado").length;
		const summary = ((summaries ?? []) as { user_id: string; points: number; quizzes_passed: number; last_activity: string | null }[]).find(
			(row) => row.user_id === input.user_id
		);
		return {
			name: names.get(input.user_id) ?? "Sin nombre",
			lessons_done: done,
			lessons_total: rows.length,
			progress_percent: rows.length ? Math.round((done / rows.length) * 100) : 0,
			points: summary?.points ?? 0,
			quizzes_passed: summary?.quizzes_passed ?? 0,
			days_inactive: daysSince(summary?.last_activity ?? null),
			modules: [...grouped.values()]
		};
	}
});

export const removeMember = defineTool({
	name: "remove_member",
	title: "Quitar a alguien del aula",
	description: "Quita la plaza de una persona del aula. Pierde el acceso. Pide confirmación explícita a la persona.",
	level: "team",
	readOnly: false,
	destructive: true,
	input: z.object({ classroom_id: id("Aula"), member_id: id("Plaza"), confirm }),
	async run({ db }, input) {
		const { data } = await db.from("classroom_members").select("id, classroom_id").eq("id", input.member_id).maybeSingle();
		if ((data as { classroom_id: string } | null)?.classroom_id !== input.classroom_id) throw new ToolError(NOT_FOUND);
		const { error } = await db.from("classroom_members").delete().eq("id", input.member_id);
		if (error) throw new ToolError("No pudimos quitar a esta persona del aula.");
		return { removed: true };
	}
});

export const setCourseGrants = defineTool({
	name: "set_course_grants",
	title: "Fijar los cursos activados de una persona",
	description:
		"Fija exactamente a qué cursos del aula tiene acceso completo una persona con plaza (los que no incluyas se le quitan). Primero consulta list_members para no quitar accesos por error; confirma con la persona.",
	level: "manager",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		user_id: id("Persona"),
		course_ids: z.array(id("Curso")).max(100).describe("Lista completa; vacía quita todos")
	}),
	async run({ db, actor }, input) {
		const { data: member } = await db
			.from("classroom_members")
			.select("id")
			.eq("classroom_id", input.classroom_id)
			.eq("user_id", input.user_id)
			.eq("status", "aprobado")
			.maybeSingle();
		if (!member) throw new ToolError("Esa persona no tiene plaza en el aula.");
		const linked = new Set(await classroomCourseIds(db, input.classroom_id));
		const wanted = [...new Set(input.course_ids)];
		if (wanted.some((courseId) => !linked.has(courseId))) throw new ToolError(NOT_FOUND);

		const removal = db.from("classroom_course_grants").delete().eq("classroom_id", input.classroom_id).eq("user_id", input.user_id);
		const { error: removeError } = wanted.length > 0 ? await removal.not("course_id", "in", `(${wanted.join(",")})`) : await removal;
		if (removeError) throw new ToolError("No pudimos guardar el acceso.");
		if (wanted.length > 0) {
			const { error } = await db.from("classroom_course_grants").upsert(
				wanted.map((courseId) => ({
					classroom_id: input.classroom_id,
					user_id: input.user_id,
					course_id: courseId,
					granted_by: actor.userId
				})),
				{ onConflict: "classroom_id,user_id,course_id" }
			);
			if (error) throw new ToolError("No pudimos guardar el acceso.");
		}
		return { user_id: input.user_id, course_ids: wanted };
	}
});

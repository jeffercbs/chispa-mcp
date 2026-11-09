import { z } from "zod";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { id } from "../domain/sanitize.js";
import { defineTool } from "../mcp/tool.js";
import { profileNames } from "./shared.js";

type Member = { id: string; user_id: string; status: string; access: string | null; trial_course_id: string | null; requested_at: string };

export const listAccessRequests = defineTool({
	name: "list_access_requests",
	title: "Solicitudes y cursos por activar",
	description: "Lista quién pide entrar al aula y quién está en prueba esperando que le actives el curso que eligió.",
	level: "manager",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula") }),
	async run({ db }, input) {
		const [{ data: members }, { data: grants }] = await Promise.all([
			db
				.from("classroom_members")
				.select("id, user_id, status, access, trial_course_id, requested_at")
				.eq("classroom_id", input.classroom_id),
			db.from("classroom_course_grants").select("user_id, course_id").eq("classroom_id", input.classroom_id)
		]);
		const rows = (members ?? []) as Member[];
		const granted = new Set(((grants ?? []) as { user_id: string; course_id: string }[]).map((row) => `${row.user_id}:${row.course_id}`));
		const pending = rows.filter((row) => row.status === "pendiente");
		const awaiting = rows.filter(
			(row) =>
				row.status === "aprobado" && row.access === "prueba" && row.trial_course_id && !granted.has(`${row.user_id}:${row.trial_course_id}`)
		);
		const names = await profileNames(
			db,
			[...pending, ...awaiting].map((row) => row.user_id)
		);
		return {
			requests: pending.map((row) => ({ member_id: row.id, name: names.get(row.user_id) ?? "Sin nombre", requested_at: row.requested_at })),
			awaiting_activation: awaiting.map((row) => ({
				user_id: row.user_id,
				name: names.get(row.user_id) ?? "Sin nombre",
				course_id: row.trial_course_id
			}))
		};
	}
});

export const decideAccessRequest = defineTool({
	name: "decide_access_request",
	title: "Aprobar o rechazar una solicitud",
	description: "Aprueba o rechaza una solicitud para entrar al aula. Confirma con la persona antes de hacerlo.",
	level: "team",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		member_id: id("Solicitud"),
		decision: z.enum(["aprobado", "rechazado"]).describe("Decisión")
	}),
	async run({ db, actor }, input) {
		const { data } = await db.from("classroom_members").select("id, classroom_id, status").eq("id", input.member_id).maybeSingle();
		const member = data as { id: string; classroom_id: string; status: string } | null;
		if (!member || member.classroom_id !== input.classroom_id) throw new ToolError(NOT_FOUND);
		if (member.status !== "pendiente") throw new ToolError("Esa solicitud ya fue decidida.");
		const { error } = await db
			.from("classroom_members")
			.update({ status: input.decision, decided_at: new Date().toISOString(), decided_by: actor.userId })
			.eq("id", member.id);
		if (error) throw new ToolError("No pudimos guardar la decisión.");
		return { member_id: member.id, status: input.decision };
	}
});

export const activateTrialCourse = defineTool({
	name: "activate_trial_course",
	title: "Activar el curso elegido",
	description: "Da acceso completo al curso que eligió una persona que está en prueba. Confirma con la persona antes de hacerlo.",
	level: "manager",
	readOnly: false,
	input: z.object({ classroom_id: id("Aula"), user_id: id("Estudiante") }),
	async run({ db, actor }, input) {
		const { data } = await db
			.from("classroom_members")
			.select("trial_course_id")
			.eq("classroom_id", input.classroom_id)
			.eq("user_id", input.user_id)
			.eq("status", "aprobado")
			.maybeSingle();
		const courseId = (data as { trial_course_id: string | null } | null)?.trial_course_id;
		if (!data) throw new ToolError("Esa persona no tiene plaza en el aula.");
		if (!courseId) throw new ToolError("Esa persona aún no eligió un curso.");
		const { error } = await db
			.from("classroom_course_grants")
			.upsert(
				{ classroom_id: input.classroom_id, user_id: input.user_id, course_id: courseId, granted_by: actor.userId },
				{ onConflict: "classroom_id,user_id,course_id" }
			);
		if (error) throw new ToolError("No pudimos activar el curso.");
		return { user_id: input.user_id, course_id: courseId, activated: true };
	}
});

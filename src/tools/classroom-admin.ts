import { z } from "zod";
import { allows } from "../domain/access.js";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { enabledTools, platformOf, requireManager, requireOwner, STUDENT_TOOLS } from "../domain/platform.js";
import { id, optionalText, patchText, text } from "../domain/sanitize.js";
import { defineTool } from "../mcp/tool.js";
import { forgetDefaultClassroom } from "./classrooms.js";

type Room = {
	name: string;
	code: string;
	description: string | null;
	is_open: boolean;
	open_enrollment: boolean;
	trial_sessions: number | null;
	student_teacher_chat: boolean;
	student_tools: unknown;
	invite_token: string | null;
	blocked: boolean;
	owner_id: string | null;
};

const count = async (query: PromiseLike<{ count: number | null }>) => (await query).count ?? 0;

export const getClassroom = defineTool({
	name: "get_classroom",
	title: "Configuración del aula",
	description:
		"Ajustes del aula: nombre, código, inscripción abierta, chat con docentes, herramientas activas para estudiantes, enlace de invitación, cifras y tu rol y permisos. También indica qué herramientas oculta la plataforma (Guías Clave no muestra foro, tableros, encuestas, recursos, clases, compañeros ni reseñas).",
	level: "team",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula") }),
	async run({ db, actor }, input) {
		const [{ data }, members, pending, staff, courses] = await Promise.all([
			db
				.from("classrooms")
				.select(
					"name, code, description, is_open, open_enrollment, trial_sessions, student_teacher_chat, student_tools, invite_token, blocked, owner_id"
				)
				.eq("id", input.classroom_id)
				.maybeSingle(),
			count(
				db
					.from("classroom_members")
					.select("id", { count: "exact", head: true })
					.eq("classroom_id", input.classroom_id)
					.eq("status", "aprobado")
			),
			count(
				db
					.from("classroom_members")
					.select("id", { count: "exact", head: true })
					.eq("classroom_id", input.classroom_id)
					.eq("status", "pendiente")
			),
			count(db.from("classroom_staff").select("user_id", { count: "exact", head: true }).eq("classroom_id", input.classroom_id)),
			count(db.from("classroom_courses").select("course_id", { count: "exact", head: true }).eq("classroom_id", input.classroom_id))
		]);
		const room = data as Room | null;
		if (!room) throw new ToolError(NOT_FOUND);
		const platform = platformOf(input.classroom_id);
		const active = enabledTools(room.student_tools);
		return {
			name: room.name,
			code: room.code,
			description: room.description,
			platform: platform.name,
			blocked: room.blocked,
			listed: room.is_open,
			open_enrollment: room.open_enrollment,
			trial_lessons: room.trial_sessions,
			student_teacher_chat: room.student_teacher_chat,
			student_tools_on: active,
			student_tools_off: STUDENT_TOOLS.filter((key) => !active.includes(key)),
			...(platform.hidden.length ? { hidden_by_platform: platform.hidden } : {}),
			...(room.invite_token ? { invite_link: `${platform.site}${platform.invitePath}/${room.invite_token}` } : {}),
			counts: { students: members, pending, staff, courses },
			you: {
				role: actor.isOwner ? "creador" : actor.role,
				permissions: Object.entries(actor.permissions)
					.filter(([, value]) => value)
					.map(([key]) => key)
			}
		};
	}
});

const toolSwitches = z.object(
	Object.fromEntries(STUDENT_TOOLS.map((key) => [key, z.boolean().optional()])) as Record<
		(typeof STUDENT_TOOLS)[number],
		z.ZodOptional<z.ZodBoolean>
	>
);

export const updateClassroom = defineTool({
	name: "update_classroom",
	title: "Configurar el aula",
	description:
		"Cambia solo lo que envíes. name, description y student_teacher_chat: administrador del aula. student_tools ({foro:true, tableros:false…}, se combina con lo actual): permiso «herramientas». listed (aparece en el buscador de aulas), open_enrollment, trial_lessons (1-20) y course_ids (reemplaza los cursos del aula; quitar uno requiere confirm): solo quien creó el aula. Confirma con la persona antes de guardar.",
	level: "team",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		name: text(120, "Nombre").optional(),
		description: patchText(2000, "Descripción"),
		student_teacher_chat: z.boolean().optional(),
		student_tools: toolSwitches.optional(),
		listed: z.boolean().optional(),
		open_enrollment: z.boolean().optional(),
		trial_lessons: z.number().int().min(1).max(20).optional(),
		course_ids: z.array(id("Curso")).max(200).optional(),
		confirm: z.boolean().default(false)
	}),
	async run({ db, actor }, input) {
		const patch: Record<string, unknown> = {};
		if (input.name !== undefined || input.description !== undefined || input.student_teacher_chat !== undefined) {
			requireManager(actor, "cambiar el nombre, la descripción o el chat");
			if (input.name !== undefined) patch.name = input.name;
			if (input.description !== undefined) patch.description = input.description;
			if (input.student_teacher_chat !== undefined) patch.student_teacher_chat = input.student_teacher_chat;
		}
		if (input.listed !== undefined || input.open_enrollment !== undefined || input.trial_lessons !== undefined || input.course_ids) {
			requireOwner(actor, "cambiar la inscripción o los cursos del aula");
			if (input.listed !== undefined) patch.is_open = input.listed;
			if (input.open_enrollment !== undefined) patch.open_enrollment = input.open_enrollment;
			if (input.trial_lessons !== undefined) patch.trial_sessions = input.trial_lessons;
		}
		if (input.student_tools) {
			if (!allows("herramientas", actor.role, actor.permissions) && !actor.systemAdmin)
				throw new ToolError("El administrador del aula no te ha dado permiso para cambiar las herramientas.");
			const { data } = await db.from("classrooms").select("student_tools").eq("id", input.classroom_id).maybeSingle();
			const current = Object.fromEntries(
				STUDENT_TOOLS.map((key) => [key, enabledTools((data as { student_tools: unknown } | null)?.student_tools).includes(key)])
			);
			patch.student_tools = {
				...current,
				...Object.fromEntries(Object.entries(input.student_tools).filter(([, value]) => value !== undefined))
			};
		}

		let courses: { added: number; removed: number } | undefined;
		if (input.course_ids) {
			const wanted = [...new Set(input.course_ids)];
			const { data: linked } = await db.from("classroom_courses").select("course_id").eq("classroom_id", input.classroom_id);
			const before = new Set(((linked ?? []) as { course_id: string }[]).map((row) => row.course_id));
			const removed = [...before].filter((courseId) => !wanted.includes(courseId));
			if (removed.length > 0 && !input.confirm)
				throw new ToolError(
					`Esto quitaría ${removed.length} curso(s) del aula y sus estudiantes dejarían de verlos.`,
					"Confírmalo con la persona y repite con confirm=true."
				);
			courses = { added: wanted.filter((courseId) => !before.has(courseId)).length, removed: removed.length };
			if (removed.length > 0) {
				const { error } = await db.from("classroom_courses").delete().eq("classroom_id", input.classroom_id).in("course_id", removed);
				if (error) throw new ToolError("No pudimos quitar los cursos.");
			}
			if (wanted.length > 0) {
				const { error } = await db.from("classroom_courses").upsert(
					wanted.map((courseId, index) => ({ classroom_id: input.classroom_id, course_id: courseId, position: index + 1 })),
					{ onConflict: "classroom_id,course_id" }
				);
				if (error) throw new ToolError("No pudimos guardar los cursos del aula.", "Revisa que sean cursos tuyos.");
				patch.course_id = wanted[0];
			}
		}

		if (Object.keys(patch).length === 0 && !courses) throw new ToolError("No indicaste nada que cambiar.");
		if (Object.keys(patch).length > 0) {
			const { error } = await db.from("classrooms").update(patch).eq("id", input.classroom_id);
			if (error) throw new ToolError("No pudimos guardar los ajustes del aula.");
		}
		return { updated: Object.keys(patch).filter((key) => key !== "course_id"), ...(courses ? { courses } : {}) };
	}
});

function codeFrom(value: string) {
	const base = value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "")
		.slice(0, 6);
	const tail = [...crypto.getRandomValues(new Uint8Array(3))]
		.map((byte) => (byte % 36).toString(36))
		.join("")
		.toUpperCase();
	return `${base || "AULA"}-${tail}`;
}

export const createClassroom = defineTool({
	name: "create_classroom",
	title: "Crear un aula",
	description:
		"Crea un aula nueva de la que serás administrador (profesores con plan y organizaciones). El plan limita cuántas aulas puedes tener. Confirma el nombre antes de crearla.",
	level: "none",
	readOnly: false,
	input: z.object({
		name: text(120, "Nombre"),
		description: optionalText(2000, "Descripción"),
		listed: z.boolean().default(false).describe("Aparece en el buscador de aulas"),
		course_ids: z.array(id("Curso")).max(200).optional()
	}),
	async run({ db, identity }, input) {
		const { data, error } = await db
			.from("classrooms")
			.insert({
				name: input.name,
				description: input.description,
				is_open: input.listed,
				code: codeFrom(input.name),
				owner_id: identity.userId,
				course_id: input.course_ids?.[0] ?? null
			})
			.select("id, code")
			.single();
		if (error || !data) {
			const plan = error?.message && /plan/i.test(error.message) ? error.message.match(/[^.!]*plan[^.!]*[.!]?/i)?.[0]?.trim() : null;
			throw new ToolError(plan ?? "No pudimos crear el aula.", plan ? "Revisa tu plan en Chispa." : undefined);
		}
		const room = data as { id: string; code: string };
		if (input.course_ids?.length) {
			const { error: linkError } = await db
				.from("classroom_courses")
				.insert(input.course_ids.map((courseId, index) => ({ classroom_id: room.id, course_id: courseId, position: index + 1 })));
			if (linkError) throw new ToolError("Creamos el aula, pero no pudimos vincular los cursos.", "Usa update_classroom con course_ids.");
		}
		forgetDefaultClassroom();
		return { classroom_id: room.id, code: room.code, platform: platformOf(room.id).name };
	}
});

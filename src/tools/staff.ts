import { z } from "zod";
import { PERMISSION_DEFAULTS, type Permission, resolvePermissions } from "../domain/access.js";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { requireManager, requireOwner } from "../domain/platform.js";
import { id } from "../domain/sanitize.js";
import { defineTool } from "../mcp/tool.js";
import { profileNames } from "./shared.js";

const MAX_ADMINS = 3;
const PERMISSIONS = Object.keys(PERMISSION_DEFAULTS) as [Permission, ...Permission[]];
const confirm = z.literal(true).describe("true solo tras confirmarlo la persona");

type StaffRow = { user_id: string; role: string; permissions: unknown };

export const listStaff = defineTool({
	name: "list_staff",
	title: "Equipo docente del aula",
	description: "Profesores y administradores del aula con sus permisos y los cursos que cada profesor puede editar.",
	level: "team",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula") }),
	async run({ db }, input) {
		const [{ data: room }, { data: staff }, { data: grants }] = await Promise.all([
			db.from("classrooms").select("owner_id").eq("id", input.classroom_id).maybeSingle(),
			db.from("classroom_staff").select("user_id, role, permissions").eq("classroom_id", input.classroom_id),
			db.from("classroom_course_grants").select("user_id, course_id").eq("classroom_id", input.classroom_id)
		]);
		const ownerId = (room as { owner_id: string | null } | null)?.owner_id ?? null;
		const rows = (staff ?? []) as StaffRow[];
		const names = await profileNames(db, [...new Set([...(ownerId ? [ownerId] : []), ...rows.map((row) => row.user_id)])]);
		const byUser = new Map<string, string[]>();
		for (const grant of (grants ?? []) as { user_id: string; course_id: string }[])
			byUser.set(grant.user_id, [...(byUser.get(grant.user_id) ?? []), grant.course_id]);
		return {
			staff: [
				...(ownerId ? [{ user_id: ownerId, name: names.get(ownerId) ?? "Sin nombre", role: "creador" }] : []),
				...rows.map((row) => {
					const role = row.role === "administrador" ? "administrador" : "profesor";
					const permissions = resolvePermissions(role, row.permissions);
					return {
						user_id: row.user_id,
						name: names.get(row.user_id) ?? "Sin nombre",
						role,
						...(role === "profesor"
							? {
									permissions: PERMISSIONS.filter((key) => permissions[key]),
									courses: byUser.get(row.user_id) ?? []
								}
							: {})
					};
				})
			]
		};
	}
});

async function staffUser(db: Parameters<typeof profileNames>[0], email: string | undefined, userId: string | undefined) {
	if (userId) return userId;
	const { data } = await db
		.from("profiles")
		.select("id")
		.ilike("email", (email ?? "").trim().toLowerCase())
		.in("role", ["profesor", "admin"])
		.maybeSingle();
	const found = (data as { id: string } | null)?.id;
	if (!found)
		throw new ToolError("No encontramos a una persona docente con ese correo.", "Debe tener una cuenta de profesor en la plataforma.");
	return found;
}

async function currentRole(db: Parameters<typeof profileNames>[0], classroomId: string, userId: string) {
	const { data } = await db.from("classroom_staff").select("role").eq("classroom_id", classroomId).eq("user_id", userId).maybeSingle();
	return (data as { role: string } | null)?.role ?? null;
}

export const addStaff = defineTool({
	name: "add_staff",
	title: "Añadir docente al equipo",
	description: `Añade a una persona docente (por correo o user_id) como profesor o administrador del aula. Nombrar administradores es solo de quien creó el aula (máximo ${MAX_ADMINS} contando al creador). Opcional: permisos y cursos que podrá editar. Confirma antes.`,
	level: "manager",
	readOnly: false,
	input: z
		.object({
			classroom_id: id("Aula"),
			email: z.email().max(200).optional(),
			user_id: id("Persona").optional(),
			role: z.enum(["profesor", "administrador"]).default("profesor"),
			permissions: z.array(z.enum(PERMISSIONS)).optional().describe("Solo para profesores: permisos que tendrá"),
			course_ids: z.array(id("Curso")).max(200).optional().describe("Solo para profesores: cursos que podrá editar")
		})
		.refine((input) => input.email || input.user_id, { error: "Indica el correo o el user_id." }),
	async run({ db, actor }, input) {
		const userId = await staffUser(db, input.email, input.user_id);
		if (userId === actor.userId) throw new ToolError("Ya formas parte del aula.");
		const existing = await currentRole(db, input.classroom_id, userId);
		if (input.role === "administrador" || existing === "administrador") requireOwner(actor, "nombrar o cambiar administradores");
		if (input.role === "administrador" && existing !== "administrador") {
			const { count } = await db
				.from("classroom_staff")
				.select("user_id", { count: "exact", head: true })
				.eq("classroom_id", input.classroom_id)
				.eq("role", "administrador");
			if (1 + (count ?? 0) >= MAX_ADMINS)
				throw new ToolError(`Un aula admite hasta ${MAX_ADMINS} administradores, contando a quien la creó.`);
		}
		const row: Record<string, unknown> = { classroom_id: input.classroom_id, user_id: userId, role: input.role };
		if (input.role === "profesor" && input.permissions)
			row.permissions = Object.fromEntries(PERMISSIONS.map((key) => [key, input.permissions?.includes(key) ?? false]));
		const { error } = await db.from("classroom_staff").upsert(row, { onConflict: "classroom_id,user_id" });
		if (error) throw new ToolError("No pudimos actualizar el equipo del aula.", "Solo se puede añadir a personas con cuenta de docente.");
		if (input.role === "profesor" && input.course_ids)
			await setTeacherCourses(db, input.classroom_id, userId, actor.userId, input.course_ids);
		return { user_id: userId, role: input.role, ...(existing ? { previous_role: existing } : {}) };
	}
});

async function setTeacherCourses(
	db: Parameters<typeof profileNames>[0],
	classroomId: string,
	userId: string,
	grantedBy: string,
	wanted: string[]
) {
	const { data: linked } = await db.from("classroom_courses").select("course_id").eq("classroom_id", classroomId);
	const allowed = new Set(((linked ?? []) as { course_id: string }[]).map((row) => row.course_id));
	const courseIds = [...new Set(wanted)];
	const outside = courseIds.filter((courseId) => !allowed.has(courseId));
	if (outside.length > 0) throw new ToolError(`${outside.length} curso(s) no están en el aula.`);
	const removal = db.from("classroom_course_grants").delete().eq("classroom_id", classroomId).eq("user_id", userId);
	const { error: removeError } = courseIds.length > 0 ? await removal.not("course_id", "in", `(${courseIds.join(",")})`) : await removal;
	if (removeError) throw new ToolError("No pudimos guardar los cursos del profesor.");
	if (courseIds.length === 0) return;
	const { error } = await db.from("classroom_course_grants").upsert(
		courseIds.map((courseId) => ({ classroom_id: classroomId, user_id: userId, course_id: courseId, granted_by: grantedBy })),
		{ onConflict: "classroom_id,user_id,course_id" }
	);
	if (error) throw new ToolError("No pudimos guardar los cursos del profesor.");
}

export const updateStaff = defineTool({
	name: "update_staff",
	title: "Permisos y cursos de un profesor",
	description: `Cambia los permisos (${PERMISSIONS.join(", ")}) y/o los cursos que puede editar un profesor del aula. permissions reemplaza la lista completa; course_ids también ([] quita todos). Confirma antes.`,
	level: "manager",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		user_id: id("Profesor"),
		permissions: z.array(z.enum(PERMISSIONS)).optional(),
		course_ids: z.array(id("Curso")).max(200).optional()
	}),
	async run({ db, actor }, input) {
		if (!input.permissions && !input.course_ids) throw new ToolError("No indicaste nada que cambiar.");
		if ((await currentRole(db, input.classroom_id, input.user_id)) !== "profesor")
			throw new ToolError("Los permisos y cursos se asignan solo a profesores del aula.");
		if (input.permissions) {
			const permissions = Object.fromEntries(PERMISSIONS.map((key) => [key, input.permissions?.includes(key) ?? false]));
			const { error } = await db
				.from("classroom_staff")
				.update({ permissions })
				.eq("classroom_id", input.classroom_id)
				.eq("user_id", input.user_id);
			if (error) throw new ToolError("No pudimos guardar los permisos.");
		}
		if (input.course_ids) await setTeacherCourses(db, input.classroom_id, input.user_id, actor.userId, input.course_ids);
		return { user_id: input.user_id, updated: [...(input.permissions ? ["permissions"] : []), ...(input.course_ids ? ["courses"] : [])] };
	}
});

export const removeStaff = defineTool({
	name: "remove_staff",
	title: "Retirar a un docente del aula",
	description:
		"Retira a un profesor (o, solo quien creó el aula, a un administrador) del equipo. No borra su cuenta ni sus cursos. Pide confirmación.",
	level: "manager",
	readOnly: false,
	destructive: true,
	input: z.object({ classroom_id: id("Aula"), user_id: id("Docente"), confirm }),
	async run({ db, actor }, input) {
		const role = await currentRole(db, input.classroom_id, input.user_id);
		if (!role) throw new ToolError(NOT_FOUND);
		if (role === "administrador") requireOwner(actor, "retirar a un administrador");
		else requireManager(actor, "gestionar el equipo");
		const { error } = await db.from("classroom_staff").delete().eq("classroom_id", input.classroom_id).eq("user_id", input.user_id);
		if (error) throw new ToolError("No pudimos retirar a esa persona del aula.");
		return { removed: true, role };
	}
});

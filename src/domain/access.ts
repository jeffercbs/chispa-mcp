import { ROLES } from "../limits.js";
import { NOT_FOUND, ToolError } from "./errors.js";
import type { Db } from "./supabase.js";

export const PERMISSION_DEFAULTS = {
	accesos: false,
	activacion: false,
	alumnos: false,
	soporte: true,
	contenido: true,
	herramientas: false,
	comercio: false
} as const;

/** Acciones que el administrador del aula puede delegar a cada profesor. */
export type Permission = keyof typeof PERMISSION_DEFAULTS;
export type Permissions = Record<Permission, boolean>;
export type Level = "none" | "team" | "manager" | Permission;

export const isPermission = (level: Level): level is Permission => level in PERMISSION_DEFAULTS;

export function resolvePermissions(role: ClassroomRole | null, raw: unknown): Permissions {
	const stored = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	return Object.fromEntries(
		(Object.keys(PERMISSION_DEFAULTS) as Permission[]).map((key) => [
			key,
			role === "administrador" ? true : typeof stored[key] === "boolean" ? stored[key] : PERMISSION_DEFAULTS[key]
		])
	) as Permissions;
}
export type ClassroomRole = "administrador" | "profesor";

export type Actor = {
	userId: string;
	classroomId: string | null;
	role: ClassroomRole | null;
	isOwner: boolean;
	permissions: Permissions;
	systemAdmin: boolean;
};

const STAFF_ROLES = new Set<string>(ROLES.staff);

export async function staffProfile(db: Db, userId: string) {
	const { data } = await db.from("profiles").select("role, blocked").eq("id", userId).maybeSingle();
	const row = data as { role?: string; blocked?: boolean } | null;
	if (!row || row.blocked || !STAFF_ROLES.has(row.role ?? "")) {
		throw new ToolError("Esta conexión solo está disponible para cuentas de docentes.");
	}
	return { systemAdmin: row.role === ROLES.systemAdmin };
}

export async function classroomRole(db: Db, classroomId: string, userId: string) {
	const [{ data: classroom }, { data: staff }] = await Promise.all([
		db.from("classrooms").select("owner_id, blocked").eq("id", classroomId).maybeSingle(),
		db.from("classroom_staff").select("role, permissions").eq("classroom_id", classroomId).eq("user_id", userId).maybeSingle()
	]);
	if (!classroom) return null;
	const row = classroom as { owner_id: string | null; blocked?: boolean };
	const isOwner = row.owner_id === userId;
	const staffRow = staff as { role?: string; permissions?: unknown } | null;
	const staffRole = staffRow?.role;
	const role: ClassroomRole | null = isOwner
		? ROLES.classroomAdmin
		: staffRole === ROLES.classroomAdmin || staffRole === ROLES.classroomTeacher
			? staffRole
			: null;
	return { role, isOwner, permissions: resolvePermissions(role, staffRow?.permissions), blocked: Boolean(row.blocked) };
}

export const allows = (level: Level, role: ClassroomRole | null, permissions?: Permissions) =>
	level === "none" ||
	(level === "team" && role !== null) ||
	(level === "manager" && role === "administrador") ||
	(isPermission(level) && role !== null && (role === "administrador" || (permissions ?? resolvePermissions(role, null))[level]));

const cache = new Map<string, { actor: Actor; level: Level; expires: number }>();
const CACHE_MAX = 200;

/** Olvida los roles recordados (por ejemplo, al cerrar sesión). */
export const forgetRoles = () => cache.clear();

/**
 * Resuelve quién es la persona y qué puede hacer en el aula. El rol se recuerda unos segundos
 * (`cacheSeconds`) para no repetir tres consultas por llamada; RLS sigue siendo la frontera real,
 * así que un rol retirado pierde acceso a los datos de inmediato aunque este recuerdo tarde en vencer.
 */
export async function resolveActor(db: Db, userId: string, level: Level, classroomId: string | null, cacheSeconds = 0): Promise<Actor> {
	if (level !== "none" && !classroomId) throw new ToolError("Indica el aula (classroom_id).");

	const key = `${userId}:${level === "none" ? "-" : classroomId}`;
	const hit = cacheSeconds > 0 ? cache.get(key) : undefined;
	if (hit && hit.expires > Date.now() && allows(level, hit.actor.role, hit.actor.permissions)) return hit.actor;

	const [{ systemAdmin }, access] = await Promise.all([
		staffProfile(db, userId),
		level === "none" || !classroomId ? null : classroomRole(db, classroomId, userId)
	]);
	if (level === "none") return { userId, classroomId: null, role: null, isOwner: false, permissions: resolvePermissions(null, null), systemAdmin };

	if (!access) throw new ToolError(NOT_FOUND);
	if (access.blocked && !access.isOwner) throw new ToolError("Esta aula está bloqueada.");
	if (!allows(level, access.role, access.permissions)) {
		throw new ToolError(
			level === "manager"
				? "Solo el administrador del aula puede hacer esto."
				: access.role !== null
					? "El administrador del aula no te ha dado permiso para esto."
					: "No formas parte del equipo de esta aula."
		);
	}
	const actor: Actor = { userId, classroomId, role: access.role, isOwner: access.isOwner, permissions: access.permissions, systemAdmin };
	if (cacheSeconds > 0) {
		if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
		cache.set(key, { actor, level, expires: Date.now() + cacheSeconds * 1000 });
	}
	return actor;
}

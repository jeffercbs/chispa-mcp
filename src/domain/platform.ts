import type { Actor } from "./access.js";
import { ToolError } from "./errors.js";

const GUIAS_CLAVE_CLASSROOMS = new Set(["fe30e4ec-52e6-4a18-ab19-fb6594b38105"]);

export const STUDENT_TOOLS = [
	"clases",
	"recursos",
	"actividades",
	"foro",
	"mensajes",
	"encuestas",
	"tableros",
	"companeros",
	"resenas",
	"asistencia",
	"notas",
	"avance",
	"plan",
	"logros"
] as const;
export type StudentTool = (typeof STUDENT_TOOLS)[number];

const GUIAS_CLAVE_HIDDEN: StudentTool[] = ["tableros", "companeros", "recursos", "foro", "encuestas", "resenas", "clases"];

export type Platform = { name: "guias_clave" | "chispa"; site: string; invitePath: string; hidden: StudentTool[] };

export function platformOf(classroomId: string, env: NodeJS.ProcessEnv = process.env): Platform {
	if (GUIAS_CLAVE_CLASSROOMS.has(classroomId))
		return {
			name: "guias_clave",
			site: env.CHISPA_GUIAS_CLAVE_URL?.trim() || "https://guiasclave.com",
			invitePath: "/unirse/invitacion",
			hidden: GUIAS_CLAVE_HIDDEN
		};
	return { name: "chispa", site: env.CHISPA_SITE_URL?.trim() || "https://modochispa.com", invitePath: "/invitacion", hidden: [] };
}

export function enabledTools(raw: unknown) {
	const stored = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	return STUDENT_TOOLS.filter((key) => stored[key] !== false);
}

export function requireOwner(actor: Actor, action: string) {
	if (!actor.isOwner && !actor.systemAdmin) throw new ToolError(`Solo quien creó el aula puede ${action}.`);
}

export function requireManager(actor: Actor, action: string) {
	if (actor.role !== "administrador" && !actor.systemAdmin) throw new ToolError(`Solo el administrador del aula puede ${action}.`);
}

export function maskEmail(email: string) {
	const [user = "", domain = ""] = email.split("@");
	return `${user.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(user.length - 2, 4)))}@${domain}`;
}

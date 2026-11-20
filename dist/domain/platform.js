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
];
const GUIAS_CLAVE_HIDDEN = ["tableros", "companeros", "recursos", "foro", "encuestas", "resenas", "clases"];
export function platformOf(classroomId, env = process.env) {
    if (GUIAS_CLAVE_CLASSROOMS.has(classroomId))
        return {
            name: "guias_clave",
            site: env.CHISPA_GUIAS_CLAVE_URL?.trim() || "https://guiasclave.com",
            invitePath: "/unirse/invitacion",
            hidden: GUIAS_CLAVE_HIDDEN
        };
    return { name: "chispa", site: env.CHISPA_SITE_URL?.trim() || "https://modochispa.com", invitePath: "/invitacion", hidden: [] };
}
export function enabledTools(raw) {
    const stored = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return STUDENT_TOOLS.filter((key) => stored[key] !== false);
}
export function requireOwner(actor, action) {
    if (!actor.isOwner && !actor.systemAdmin)
        throw new ToolError(`Solo quien creó el aula puede ${action}.`);
}
export function requireManager(actor, action) {
    if (actor.role !== "administrador" && !actor.systemAdmin)
        throw new ToolError(`Solo el administrador del aula puede ${action}.`);
}
export function maskEmail(email) {
    const [user = "", domain = ""] = email.split("@");
    return `${user.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(user.length - 2, 4)))}@${domain}`;
}

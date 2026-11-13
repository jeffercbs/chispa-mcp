import { z } from "zod";
import { beginLogin } from "../auth/oauth.js";
import { currentIdentity } from "../auth/session.js";
import { clearTokens } from "../auth/store.js";
import { userClient } from "../domain/supabase.js";
import { defineTool } from "../mcp/tool.js";
import { pendingUpdate } from "../update.js";
/** Cuánto espera `login` a que la persona apruebe antes de devolver la dirección y seguir esperando. */
const WAIT_MS = 40_000;
let current = null;
async function emailOf(config) {
    const identity = await currentIdentity(config);
    if (!identity)
        return null;
    const { data } = await userClient(config, identity.token).auth.getUser(identity.token);
    return data?.user?.email ?? identity.userId;
}
const updateNote = () => {
    const next = pendingUpdate();
    return next ? { update: `Hay una versión nueva (${next}). Se instalará sola la próxima vez que reinicies el cliente de IA.` } : {};
};
export const login = defineTool({
    name: "login",
    title: "Iniciar sesión",
    description: "Inicia sesión con la cuenta de Chispa de la persona. Abre el navegador para que pulse «Permitir». Úsala cuando otra herramienta diga que no hay sesión, o si la persona pide conectarse. Si responde `waiting`, pide que apruebe en el navegador y vuelve a llamarla.",
    level: "none",
    readOnly: false,
    public: true,
    input: z.object({}),
    async run({ config }) {
        if (!config)
            throw new Error("Configuración no disponible.");
        const email = await emailOf(config);
        if (email)
            return { status: "signed_in", account: email, message: `Sesión activa como ${email}.`, ...updateNote() };
        if (current?.state === "waiting") {
            await Promise.race([current.flow.finished.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, WAIT_MS))]);
        }
        else {
            try {
                const flow = await beginLogin(config);
                const entry = { url: flow.url, state: "waiting", flow };
                current = entry;
                flow.finished.then(() => {
                    entry.state = "done";
                }, (error) => {
                    entry.state = "failed";
                    entry.error = error instanceof Error ? error.message : "No se pudo iniciar sesión.";
                });
                await Promise.race([flow.finished.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, WAIT_MS))]);
            }
            catch (error) {
                return { status: "error", message: error instanceof Error ? error.message : "No se pudo iniciar el inicio de sesión." };
            }
        }
        const after = await emailOf(config);
        if (after)
            return { status: "signed_in", account: after, message: `Listo, sesión iniciada como ${after}.`, ...updateNote() };
        if (current?.state === "failed") {
            const reason = current.error;
            current = null;
            return { status: "error", message: `${reason} Vuelve a llamar a login para intentarlo de nuevo.` };
        }
        return {
            status: "waiting",
            url: current?.url,
            message: "Se abrió el navegador. Pídele a la persona que pulse «Permitir» con su cuenta de Chispa (si no se abrió, que use la dirección). Luego vuelve a llamar a login."
        };
    }
});
export const logout = defineTool({
    name: "logout",
    title: "Cerrar sesión",
    description: "Borra la sesión guardada en este equipo. Para volver a usar las herramientas habrá que llamar a login.",
    level: "none",
    readOnly: false,
    public: true,
    input: z.object({}),
    async run({ config }) {
        if (!config)
            throw new Error("Configuración no disponible.");
        const removed = await clearTokens(config.dir, config.url);
        current = null;
        return { status: "signed_out", message: removed ? "Sesión cerrada en este equipo." : "No había sesión guardada." };
    }
});
export const SESSION_TOOLS = [login, logout];

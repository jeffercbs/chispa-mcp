import { createInterface } from "node:readline";
import { currentIdentity } from "./auth/session.js";
import { WriteLimiter } from "./domain/rate.js";
import { userClient } from "./domain/supabase.js";
import { LIMITS } from "./limits.js";
import { handleRequest } from "./mcp/handler.js";
import { failure, parseRequest, RPC, success } from "./mcp/protocol.js";
import { TOOLS } from "./tools/index.js";
import { SESSION_TOOLS } from "./tools/session.js";
import { checkForUpdate } from "./update.js";
export const LOGIN_HINT = "No has iniciado sesión. Llama a la herramienta `login`: abre el navegador para que la persona pulse «Permitir» y después repite lo que estabas haciendo.";
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
export async function serve(config) {
    // Semilla del seudónimo de auditoría: solo vive en este proceso.
    const auditSecret = crypto.randomUUID() + crypto.randomUUID();
    const limiter = new WriteLimiter(config.writesPerMinute);
    const policy = { roleCacheSeconds: config.roleCacheSeconds, currency: config.currency };
    const tools = [...SESSION_TOOLS, ...TOOLS];
    void checkForUpdate();
    const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
    for await (const line of lines) {
        if (!line.trim())
            continue;
        if (line.length > LIMITS.message) {
            send(failure(null, RPC.invalidRequest, "La solicitud es demasiado grande."));
            continue;
        }
        let body;
        try {
            body = JSON.parse(line);
        }
        catch {
            send(failure(null, RPC.parseError, "El mensaje no es JSON válido."));
            continue;
        }
        if (Array.isArray(body)) {
            send(failure(null, RPC.invalidRequest, "No se admiten lotes de solicitudes."));
            continue;
        }
        const request = parseRequest(body);
        if (!request) {
            send(failure(null, RPC.invalidRequest, "Solicitud JSON-RPC no válida."));
            continue;
        }
        try {
            const calling = request.method === "tools/call";
            const open = calling && tools.some((tool) => tool.public && tool.name === request.params?.name);
            const identity = calling && !open ? await currentIdentity(config) : null;
            if (calling && !open && !identity) {
                if (request.id !== undefined)
                    send(success(request.id, { content: [{ type: "text", text: LOGIN_HINT }], isError: true }));
                continue;
            }
            const response = await handleRequest(request, {
                db: userClient(config, identity?.token),
                identity: identity ?? { userId: "", clientId: null, token: "", expiresAt: 0 },
                auditSecret,
                policy,
                limiter,
                config,
                tools
            });
            if (response)
                send(response);
        }
        catch {
            console.error(JSON.stringify({ event: "mcp.error", message: "request_failed" }));
            if (request.id !== undefined)
                send(failure(request.id, RPC.internal, "No pudimos completar la solicitud."));
        }
    }
}

import { z } from "zod";
import type { Identity } from "../auth/identity.js";
import { resolveActor } from "../domain/access.js";
import { audit } from "../domain/audit.js";
import { GENERIC_FAILURE, ToolError } from "../domain/errors.js";
import type { WriteLimiter } from "../domain/rate.js";
import type { Db } from "../domain/supabase.js";
import { DEFAULT_CURRENCY, LIMITS } from "../limits.js";
import { INSTRUCTIONS } from "./instructions.js";
import { getPrompt, listPrompts } from "./prompts.js";
import { failure, negotiate, RPC, type RpcRequest, type RpcResponse, SERVER_INFO, success } from "./protocol.js";
import type { Tool } from "./tool.js";

export type HandlerContext = {
	db: Db;
	identity: Identity;
	auditSecret: string;
	tools: readonly Tool[];
	/** Ajustes operativos (ver config.ts). */
	policy?: { roleCacheSeconds: number; currency: string };
	/** Freno a las escrituras por minuto. */
	limiter?: WriteLimiter;
};

const LEVEL_LABEL = { none: "Cuenta docente", team: "Equipo del aula", manager: "Administrador del aula" } as const;

export function describeTools(tools: readonly Tool[]) {
	return tools.map((tool) => ({
		name: tool.name,
		title: tool.title,
		description: `[${LEVEL_LABEL[tool.level]}${tool.destructive ? " · irreversible" : tool.readOnly ? " · solo lectura" : ""}] ${tool.description}`,
		inputSchema: z.toJSONSchema(tool.input, { io: "input", unrepresentable: "any" }),
		annotations: { title: tool.title, readOnlyHint: tool.readOnly, destructiveHint: Boolean(tool.destructive), openWorldHint: false }
	}));
}

/** Hasta unos cuantos errores con el campo afectado, para que el modelo corrija todo de una vez. */
function describeValidation(error: z.ZodError) {
	const lines = error.issues.slice(0, LIMITS.issuesShown).map((issue) => {
		const where = issue.path.length > 0 ? `«${issue.path.join(".")}»: ` : "";
		return `- ${where}${issue.message}`;
	});
	const more = error.issues.length > LIMITS.issuesShown ? `\n… y ${error.issues.length - LIMITS.issuesShown} problema(s) más.` : "";
	return `Los datos no son válidos, no se guardó nada:\n${lines.join("\n")}${more}`;
}

async function callTool(request: RpcRequest, context: HandlerContext): Promise<RpcResponse> {
	const id = request.id ?? null;
	const name = request.params?.name;
	const tool = typeof name === "string" ? context.tools.find((item) => item.name === name) : undefined;
	if (!tool) return failure(id, RPC.invalidParams, "Esa herramienta no existe.");

	const started = Date.now();
	const parsed = tool.input.safeParse(request.params?.arguments ?? {});
	const classroomId = parsed.success && typeof parsed.data.classroom_id === "string" ? parsed.data.classroom_id : null;
	const log = (outcome: "ok" | "denied" | "invalid" | "error") =>
		audit(context.auditSecret, {
			tool: tool.name,
			userId: context.identity.userId,
			classroomId,
			client: context.identity.clientId,
			outcome,
			ms: Date.now() - started
		});

	if (!parsed.success) {
		await log("invalid");
		return success(id, { content: [{ type: "text", text: describeValidation(parsed.error) }], isError: true });
	}

	if (!tool.readOnly && context.limiter) {
		const wait = context.limiter.take();
		if (wait > 0) {
			await log("denied");
			return success(id, {
				content: [
					{
						type: "text",
						text: `Se hicieron demasiados cambios seguidos. Espera ${wait} segundos y continúa; avisa a la persona del avance.`
					}
				],
				isError: true
			});
		}
	}

	try {
		const actor = await resolveActor(context.db, context.identity.userId, tool.level, classroomId, context.policy?.roleCacheSeconds ?? 0);
		const value = await tool.run(
			{ db: context.db, identity: context.identity, actor, currency: context.policy?.currency ?? DEFAULT_CURRENCY },
			parsed.data
		);
		await log("ok");
		return success(id, { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
	} catch (error) {
		const known = error instanceof ToolError;
		await log(known ? "denied" : "error");
		if (!known)
			console.error(JSON.stringify({ event: "mcp.error", tool: tool.name, message: error instanceof Error ? error.name : "unknown" }));
		const message = known ? `${error.message}${error.hint ? ` ${error.hint}` : ""}` : GENERIC_FAILURE;
		return success(id, { content: [{ type: "text", text: message }], isError: true });
	}
}

export async function handleRequest(request: RpcRequest, context: HandlerContext): Promise<RpcResponse | null> {
	const id = request.id ?? null;
	const notification = request.id === undefined;

	switch (request.method) {
		case "initialize":
			return success(id, {
				protocolVersion: negotiate(request.params?.protocolVersion),
				capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
				serverInfo: SERVER_INFO,
				instructions: INSTRUCTIONS
			});
		case "ping":
			return success(id, {});
		case "tools/list":
			return success(id, { tools: describeTools(context.tools) });
		case "tools/call":
			return callTool(request, context);
		case "prompts/list":
			return success(id, { prompts: listPrompts() });
		case "prompts/get": {
			const prompt = getPrompt(request.params?.name, request.params?.arguments);
			if (!prompt) return failure(id, RPC.invalidParams, "Ese flujo guiado no existe.");
			if (!prompt.ok) return failure(id, RPC.invalidParams, prompt.message);
			return success(id, { description: prompt.description, messages: prompt.messages });
		}
		default:
			if (notification) return null;
			return failure(id, RPC.methodNotFound, "Método no disponible.");
	}
}

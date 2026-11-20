import { z } from "zod";
import type { Identity } from "../auth/identity.js";
import type { Config } from "../config.js";
import { resolveActor, resolvePermissions } from "../domain/access.js";
import { aliases, isAlias, shortenIds } from "../domain/aliases.js";
import { audit } from "../domain/audit.js";
import { GENERIC_FAILURE, ToolError } from "../domain/errors.js";
import type { WriteLimiter } from "../domain/rate.js";
import type { Db } from "../domain/supabase.js";
import { DEFAULT_CURRENCY, LIMITS } from "../limits.js";
import { defaultClassroom } from "../tools/classrooms.js";
import { compactJson, encode } from "./encode.js";
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
	config?: Config;
	/** Freno a las escrituras por minuto. */
	limiter?: WriteLimiter;
};

const LEVEL_LABEL: Partial<Record<string, string>> = { manager: "Solo administrador del aula. " };
const levelLabel = (level: Tool["level"]) =>
	LEVEL_LABEL[level] ?? (level === "none" || level === "team" ? "" : `Requiere permiso «${level}». `);

const SAFE_INT = 9_007_199_254_740_991;
const DROPPED = new Set(["$schema", "pattern", "maxLength", "minLength"]);

const isIdName = (name: string) => /(^|_)ids?$/.test(name);

function stripIdLabel(node: unknown) {
	if (!node || typeof node !== "object") return node;
	const copy = { ...(node as Record<string, unknown>) };
	if (typeof copy.description === "string" && copy.description.length <= 24) delete copy.description;
	if (copy.items && typeof copy.items === "object") copy.items = stripIdLabel(copy.items);
	return copy;
}

/** Quita del esquema lo que no ayuda al modelo y solo gasta contexto: regex, techos internos y valores obvios. */
export function slimSchema(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(slimSchema);
	if (!node || typeof node !== "object") return node;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(node)) {
		if (DROPPED.has(key)) continue;
		if (key === "format" && value === "uuid") continue;
		if (key === "default" && value === false) continue;
		if ((key === "maximum" && typeof value === "number" && value >= 10_000) || (key === "minimum" && value === -SAFE_INT)) continue;
		if (key === "maxItems" && typeof value === "number" && value >= 50) continue;
		if (key === "properties" && value && typeof value === "object") {
			out.properties = Object.fromEntries(
				Object.entries(value as Record<string, unknown>).map(([name, schema]) => [
					name,
					slimSchema(isIdName(name) ? stripIdLabel(schema) : schema)
				])
			);
			continue;
		}
		out[key] = slimSchema(value);
	}
	if (Array.isArray(out.required)) {
		const required = (out.required as string[]).filter((name) => name !== "classroom_id");
		if (required.length > 0) out.required = required;
		else delete out.required;
	}
	return out;
}

export function describeTools(tools: readonly Tool[]) {
	return tools.map((tool) => ({
		name: tool.name,
		title: tool.title,
		description: `${levelLabel(tool.level)}${tool.description}`,
		inputSchema: slimSchema(z.toJSONSchema(tool.input, { io: "input", unrepresentable: "any" })),
		annotations: tool.readOnly ? { readOnlyHint: true } : { destructiveHint: Boolean(tool.destructive) }
	}));
}

function hasUnknownAlias(value: unknown): boolean {
	if (typeof value === "string") return isAlias(value) && aliases.resolve(value) === null;
	if (Array.isArray(value)) return value.some(hasUnknownAlias);
	if (value && typeof value === "object") return Object.values(value).some(hasUnknownAlias);
	return false;
}

async function prepareArguments(tool: Tool, raw: unknown, context: HandlerContext) {
	const args = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
	const wantsJson = args.format === "json" && !("format" in tool.input.shape);
	if (wantsJson) delete args.format;
	if (!tool.public) {
		await aliases.use(context.config?.dir, context.identity.userId);
		if (hasUnknownAlias(args)) await aliases.refresh();
		if ("classroom_id" in tool.input.shape && (args.classroom_id === undefined || args.classroom_id === "")) {
			const room = await defaultClassroom(context.db, context.identity.userId);
			if (!room)
				throw new ToolError("Indica el aula (classroom_id).", "Tienes varias aulas o ninguna: consúltalas con list_my_classrooms.");
			args.classroom_id = room;
		}
	}
	return { args, wantsJson };
}

function render(tool: Tool, value: Record<string, unknown>, wantsJson: boolean) {
	const short = tool.public ? value : shortenIds(value);
	return wantsJson ? compactJson(short) : encode(short);
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
	let prepared: Awaited<ReturnType<typeof prepareArguments>>;
	try {
		prepared = await prepareArguments(tool, request.params?.arguments, context);
	} catch (error) {
		const message = error instanceof ToolError ? `${error.message}${error.hint ? ` ${error.hint}` : ""}` : GENERIC_FAILURE;
		return success(id, { content: [{ type: "text", text: message }], isError: true });
	}
	const parsed = tool.input.safeParse(prepared.args);
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
		// Las herramientas públicas (login, logout) funcionan sin sesión, así que no hay rol que resolver.
		const actor = tool.public
			? {
					userId: context.identity.userId,
					classroomId: null,
					role: null,
					isOwner: false,
					permissions: resolvePermissions(null, null),
					systemAdmin: false
				}
			: await resolveActor(context.db, context.identity.userId, tool.level, classroomId, context.policy?.roleCacheSeconds ?? 0);
		const value = await tool.run(
			{ db: context.db, identity: context.identity, actor, currency: context.policy?.currency ?? DEFAULT_CURRENCY, config: context.config },
			parsed.data
		);
		await log("ok");
		return success(id, { content: [{ type: "text", text: render(tool, value, prepared.wantsJson) }] });
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

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handleRequest } from "../src/mcp/handler.js";
import { defineTool, type Tool } from "../src/mcp/tool.js";
import { TOOLS } from "../src/tools/index.js";

const USER = "11111111-1111-4111-8111-111111111111";
const ROOM = "22222222-2222-4222-8222-222222222222";

function fakeDb(tables: Record<string, Record<string, unknown> | null>) {
	const query = (table: string) => {
		const chain = {
			select: () => chain,
			eq: () => chain,
			maybeSingle: async () => ({ data: tables[table] ?? null })
		};
		return chain;
	};
	return { from: query } as never;
}

const echo = defineTool({
	name: "echo_room",
	title: "Eco",
	description: "Prueba",
	level: "manager",
	readOnly: true,
	input: z.object({ classroom_id: z.uuid() }),
	run: async (_context, input) => ({ room: input.classroom_id })
}) as unknown as Tool;

const context = (tables: Record<string, Record<string, unknown> | null>) => ({
	db: fakeDb(tables),
	identity: { userId: USER, clientId: null, token: "t", expiresAt: 0 },
	auditSecret: "x".repeat(32),
	tools: [echo]
});

const call = (args: unknown, tables: Record<string, Record<string, unknown> | null>) =>
	handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo_room", arguments: args } }, context(tables));

describe("despachador MCP", () => {
	it("todas las herramientas declaran un esquema JSON", async () => {
		const response = await handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { ...context({}), tools: TOOLS });
		const tools = (response as { result: { tools: { name: string; inputSchema: { type: string } }[] } }).result.tools;
		expect(tools.length).toBe(TOOLS.length);
		for (const tool of tools) expect(tool.inputSchema.type).toBe("object");
	});

	it("rechaza argumentos no válidos sin ejecutar la herramienta", async () => {
		const response = await call({ classroom_id: "no-es-uuid" }, {});
		expect(response).toMatchObject({ result: { isError: true } });
	});

	it("niega a quien no es docente", async () => {
		const response = await call({ classroom_id: ROOM }, { profiles: { role: "estudiante" } });
		expect(JSON.stringify(response)).toContain("solo está disponible para cuentas de docentes");
	});

	it("niega al profesor una acción de administrador", async () => {
		const response = await call(
			{ classroom_id: ROOM },
			{ profiles: { role: "profesor" }, classrooms: { owner_id: "otro" }, classroom_staff: { role: "profesor" } }
		);
		expect(JSON.stringify(response)).toContain("Solo el administrador del aula");
	});

	it("permite al administrador del aula", async () => {
		const response = await call({ classroom_id: ROOM }, { profiles: { role: "profesor" }, classrooms: { owner_id: USER } });
		expect(response).toMatchObject({ result: { structuredContent: { room: ROOM } } });
	});

	it("responde a notificaciones sin cuerpo y a métodos desconocidos con error", async () => {
		expect(await handleRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, context({}))).toBeNull();
		expect(await handleRequest({ jsonrpc: "2.0", id: 2, method: "resources/list" }, context({}))).toMatchObject({
			error: { code: -32601 }
		});
	});
});

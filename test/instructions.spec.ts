import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/mcp/handler.js";
import { INSTRUCTIONS } from "../src/mcp/instructions.js";
import { TOOLS } from "../src/tools/index.js";

const context = {
	db: {} as never,
	identity: { userId: "u", clientId: null, token: "t", expiresAt: 0 },
	auditSecret: "x".repeat(32),
	tools: TOOLS
};

describe("instrucciones y flujos guiados", () => {
	it("las instrucciones citan herramientas que existen", () => {
		const names = new Set(TOOLS.map((tool) => tool.name));
		for (const match of INSTRUCTIONS.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)) {
			const word = match[1] as string;
			if (/^(import_|add_|get_|list_|edit_|delete_|search_|set_)/.test(word)) expect(names.has(word), word).toBe(true);
		}
	});

	it("initialize entrega las instrucciones y anuncia los flujos guiados", async () => {
		const response = (await handleRequest(
			{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
			context
		)) as { result: { instructions: string; capabilities: { prompts: unknown } } };
		expect(response.result.instructions).toContain("AHORRO");
		expect(response.result.instructions.length).toBeLessThan(3_600);
		expect(response.result.capabilities.prompts).toBeDefined();
	});

	it("lista y entrega los prompts, y valida los argumentos obligatorios", async () => {
		const list = (await handleRequest({ jsonrpc: "2.0", id: 2, method: "prompts/list" }, context)) as {
			result: { prompts: { name: string }[] };
		};
		expect(list.result.prompts.map((prompt) => prompt.name)).toContain("cargar_simulacro");
		const ok = await handleRequest(
			{ jsonrpc: "2.0", id: 3, method: "prompts/get", params: { name: "cargar_simulacro", arguments: { tema: "Biología" } } },
			context
		);
		expect(JSON.stringify(ok)).toContain("Biología");
		const missing = await handleRequest(
			{ jsonrpc: "2.0", id: 4, method: "prompts/get", params: { name: "crear_curso_completo" } },
			context
		);
		expect(missing).toMatchObject({ error: { code: -32602 } });
		expect(await handleRequest({ jsonrpc: "2.0", id: 5, method: "prompts/get", params: { name: "nope" } }, context)).toMatchObject({
			error: { code: -32602 }
		});
	});

	it("solo las herramientas restringidas anuncian quién puede usarlas", async () => {
		const response = (await handleRequest({ jsonrpc: "2.0", id: 6, method: "tools/list" }, context)) as {
			result: { tools: { name: string; description: string }[] };
		};
		for (const tool of response.result.tools) {
			const level = TOOLS.find((item) => item.name === tool.name)?.level;
			if (level === "manager") expect(tool.description, tool.name).toMatch(/^Solo administrador del aula\./);
			else if (level === "none" || level === "team") expect(tool.description, tool.name).not.toMatch(/^\[/);
			else expect(tool.description, tool.name).toMatch(/^Requiere permiso/);
		}
	});

	it("la guía cubre los temas que las instrucciones mandan a consultar", async () => {
		for (const topic of ["presentaciones", "juegos", "imagenes", "precios", "modulos_compartidos", "carga_masiva"]) {
			const response = (await handleRequest(
				{ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "guide", arguments: { topic } } },
				context
			)) as { result: { content: { text: string }[]; isError?: boolean } };
			expect(response.result.isError, topic).toBeFalsy();
			expect(response.result.content[0]?.text.length, topic).toBeGreaterThan(100);
		}
	});

	it("los errores de validación citan el campo y varios problemas a la vez", async () => {
		const response = (await handleRequest(
			{
				jsonrpc: "2.0",
				id: 7,
				method: "tools/call",
				params: {
					name: "add_quiz_questions",
					arguments: { classroom_id: "no", session_id: "tampoco", questions: [{ prompt: "", options: ["a"], correct: 9 }] }
				}
			},
			context
		)) as { result: { content: { text: string }[]; isError: boolean } };
		expect(response.result.isError).toBe(true);
		expect(response.result.content[0]?.text).toContain("classroom_id");
		expect(response.result.content[0]?.text.split("\n").length).toBeGreaterThan(2);
	});
});

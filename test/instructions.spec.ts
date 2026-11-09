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
			if (/^(dry_run|confirm|import_|add_|get_|list_)/.test(word) && !/^(dry_run|confirm)/.test(word))
				expect(names.has(word), word).toBe(true);
		}
	});

	it("initialize entrega las instrucciones y anuncia los flujos guiados", async () => {
		const response = (await handleRequest(
			{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
			context
		)) as { result: { instructions: string; capabilities: { prompts: unknown } } };
		expect(response.result.instructions).toContain("CARGA MASIVA");
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

	it("cada herramienta indica quién puede usarla", async () => {
		const response = (await handleRequest({ jsonrpc: "2.0", id: 6, method: "tools/list" }, context)) as {
			result: { tools: { description: string }[] };
		};
		for (const tool of response.result.tools)
			expect(tool.description).toMatch(/^\[(Cuenta docente|Equipo del aula|Administrador del aula)/);
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

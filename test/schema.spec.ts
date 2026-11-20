import { describe, expect, it } from "vitest";
import { describeTools } from "../src/mcp/handler.js";
import { TOOLS } from "../src/tools/index.js";

const listed = describeTools(TOOLS);
const text = JSON.stringify(listed);

describe("esquemas ligeros", () => {
	it("no repite regex, $schema ni techos internos", () => {
		expect(text).not.toContain('"pattern"');
		expect(text).not.toContain('"$schema"');
		expect(text).not.toContain('"maxLength"');
		expect(text).not.toContain("9007199254740991");
	});

	it("classroom_id nunca es obligatorio en el esquema publicado", () => {
		for (const tool of listed) {
			const required = (tool.inputSchema as { required?: string[] }).required ?? [];
			expect(required, tool.name).not.toContain("classroom_id");
		}
	});

	it("presupuesto: la lista completa de herramientas no vuelve a inflarse", () => {
		expect(text.length).toBeLessThan(80_000);
	});
});

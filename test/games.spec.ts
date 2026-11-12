import { describe, expect, it } from "vitest";
import { evaluate } from "../src/domain/formula.js";
import { findElement } from "../src/domain/periodic-table.js";
import { INSTRUCTIONS } from "../src/mcp/instructions.js";
import { TOOLS } from "../src/tools/index.js";

describe("juegos dinámicos", () => {
	it("save_game documenta los tipos nuevos y las instrucciones los explican", () => {
		const tool = TOOLS.find((item) => item.name === "save_game");
		expect(tool?.description).toContain("tabla_periodica");
		expect(tool?.description).toContain("formula");
		expect(INSTRUCTIONS).toContain("JUEGOS (save_game)");
	});

	it("el evaluador y la tabla funcionan sin ejecutar código", () => {
		expect(evaluate("m*9.8*h", { m: 2, h: 10 })).toBeCloseTo(196);
		expect(() => evaluate("constructor.constructor('x')()")).toThrow();
		expect(findElement("hierro")?.symbol).toBe("Fe");
	});
});

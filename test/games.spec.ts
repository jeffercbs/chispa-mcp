import { describe, expect, it } from "vitest";
import { evaluate } from "../src/domain/formula.js";
import { findElement } from "../src/domain/periodic-table.js";
import { GUIDES } from "../src/tools/guide.js";
import { TOOLS } from "../src/tools/index.js";

describe("juegos dinámicos", () => {
	it("save_game documenta los tipos nuevos y las instrucciones los explican", () => {
		const tool = TOOLS.find((item) => item.name === "save_game");
		expect(tool?.description).toContain("guide(topic=juegos)");
		expect(GUIDES.juegos).toContain("tabla_periodica");
		expect(GUIDES.juegos).toContain("formula");
	});

	it("el evaluador y la tabla funcionan sin ejecutar código", () => {
		expect(evaluate("m*9.8*h", { m: 2, h: 10 })).toBeCloseTo(196);
		expect(() => evaluate("constructor.constructor('x')()")).toThrow();
		expect(findElement("hierro")?.symbol).toBe("Fe");
	});
});

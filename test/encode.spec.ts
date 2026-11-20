import { describe, expect, it } from "vitest";
import { compactJson, encode, rawText } from "../src/mcp/encode.js";

describe("texto compacto", () => {
	it("convierte listas uniformes en una tabla con cabecera", () => {
		const text = encode({
			total: 2,
			courses: [
				{ id: "@1", title: "Biología", published: true },
				{ id: "@2", title: "Química | orgánica", published: false }
			]
		});
		expect(text).toBe("total: 2\ncourses[2]{id,title,published}:\n  @1 | Biología | true\n  @2 | Química \\| orgánica | false");
	});

	it("omite vacíos y nulos, pero conserva false y 0", () => {
		expect(encode({ a: null, b: "", c: [], d: false, e: 0 })).toBe("d: false\ne: 0");
	});

	it("anida listas de objetos no uniformes con viñetas", () => {
		const text = encode({
			modules: [
				{
					id: "@1",
					title: "M1",
					lessons: [
						{ id: "@2", n: 1 },
						{ id: "@3", n: 2 }
					]
				}
			]
		});
		expect(text).toBe("modules[1]:\n  - id: @1\n    title: M1\n    lessons[2]{id,n}:\n      @2 | 1\n      @3 | 2");
	});

	it("escapa saltos de línea y une opciones en una celda", () => {
		const text = encode({
			q: [
				{ p: "a\nb", options: ["x;y", "z"] },
				{ p: "c", options: ["w"] }
			]
		});
		expect(text).toContain("a\\nb | x\\;y; z");
	});

	it("devuelve texto crudo cuando la herramienta lo pide", () => {
		expect(encode(rawText("línea 1\nlínea 2"))).toBe("línea 1\nlínea 2");
	});

	it("el JSON compacto quita nulos y vacíos", () => {
		expect(compactJson({ a: null, b: "", c: 1 })).toBe('{"c":1}');
	});
});

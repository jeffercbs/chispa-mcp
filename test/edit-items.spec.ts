import { describe, expect, it } from "vitest";
import { aliases } from "../src/domain/aliases.js";
import { collectEdits } from "../src/tools/edit-items.js";

const Q = "aaaaaaaa-0000-4000-8000-000000000001";

describe("edición masiva", () => {
	it("lee líneas con ID delante y conserva saltos de línea escapados", async () => {
		await aliases.use(undefined, "editor");
		const ref = aliases.alias(Q);
		const entries = collectEdits("exam_question", {
			lines: `${ref} | Caso:\\n¿Qué hacer? | Nada | *Actuar | explicación: Porque sí | tema: Ética\n¿Nueva? | *Sí | No`
		});
		expect(entries[0]).toMatchObject({
			id: Q,
			patch: { prompt: "Caso:\n¿Qué hacer?", correct: 2, explanation: "Porque sí", topic: "Ética" }
		});
		expect(entries[1]).toMatchObject({ id: undefined, patch: { prompt: "¿Nueva?", options: ["Sí", "No"], correct: 1 } });
	});

	it("acepta cambios parciales por items y rechaza campos desconocidos", () => {
		const ok = collectEdits("lesson", { items: [{ id: Q, published: true }] });
		expect(ok[0]?.patch).toEqual({ published: true });
		expect(() => collectEdits("lesson", { items: [{ id: Q, color: "rojo" }] })).toThrow(/item 1/);
	});

	it("exige los campos completos para crear y el id para lo que solo se edita", () => {
		expect(() => collectEdits("flashcard", { items: [{ front: "solo anverso" }] })).toThrow(/faltan: back/);
		expect(() => collectEdits("module", { items: [{ title: "Nuevo" }] })).toThrow(/falta `id`/);
	});

	it("indica la línea exacta de cada error", () => {
		expect(() => collectEdits("quiz_question", { lines: "¿Bien? | *a | b\n¿Mal? | a | b" })).toThrow(/línea 2/);
	});
});

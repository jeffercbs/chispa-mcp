import { describe, expect, it } from "vitest";
import { TOOLS } from "../src/tools/index.js";

describe("catálogo de herramientas", () => {
	it("no repite nombres", () => {
		const names = TOOLS.map((tool) => tool.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it("las que borran o transfieren están marcadas como destructivas", () => {
		for (const tool of TOOLS.filter((item) => /^(delete|remove|transfer)_/.test(item.name))) {
			expect(tool.destructive, tool.name).toBe(true);
			expect(tool.readOnly, tool.name).toBe(false);
		}
	});

	it("las de solo lectura nunca son destructivas", () => {
		for (const tool of TOOLS.filter((item) => item.readOnly)) expect(tool.destructive, tool.name).toBeFalsy();
	});

	it("los borrados de curso, módulo, lección, examen, escenario, colección y plaza exigen confirm", () => {
		const names = [
			"delete_course",
			"transfer_course",
			"delete_module",
			"delete_lesson",
			"delete_exam",
			"delete_scenario",
			"delete_collection",
			"remove_member",
			"delete_offer",
			"delete_chat"
		];
		for (const name of names) {
			const tool = TOOLS.find((item) => item.name === name);
			expect(tool, name).toBeDefined();
			expect(tool && "confirm" in tool.input.shape, name).toBe(true);
		}
	});

	it("cada herramienta de aula pide classroom_id (salvo las personales)", () => {
		for (const tool of TOOLS) {
			if (tool.level === "none") continue;
			expect("classroom_id" in tool.input.shape, tool.name).toBe(true);
		}
	});

	it("las cargas masivas se pueden validar sin guardar (dry_run) y por texto compacto", () => {
		for (const name of ["import_exam", "import_module_content", "add_exam_questions", "add_quiz_questions", "add_flashcards"]) {
			const tool = TOOLS.find((item) => item.name === name);
			expect(tool && "dry_run" in tool.input.shape, name).toBe(true);
		}
	});

	it("ninguna herramienta anuncia más de lo que la plataforma admite", () => {
		const exam = TOOLS.find((item) => item.name === "add_exam_questions");
		expect(JSON.stringify(exam?.description)).toContain("200");
	});
});

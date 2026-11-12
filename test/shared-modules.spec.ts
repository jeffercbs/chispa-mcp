import { describe, expect, it } from "vitest";
import { INSTRUCTIONS } from "../src/mcp/instructions.js";
import { TOOLS } from "../src/tools/index.js";

describe("módulos compartidos", () => {
	it("registra las herramientas y las documenta en las instrucciones", () => {
		const names = new Set(TOOLS.map((tool) => tool.name));
		for (const name of ["list_shared_modules", "link_shared_module", "unlink_shared_module", "move_shared_module", "set_course_library"]) {
			expect(names.has(name), name).toBe(true);
			expect(INSTRUCTIONS).toContain(name);
		}
	});

	it("las que cambian lo que ven los estudiantes exigen confirmación", () => {
		const need = ["unlink_shared_module", "set_course_library"];
		for (const tool of TOOLS.filter((item) => need.includes(item.name))) {
			expect("confirm" in tool.input.shape, tool.name).toBe(true);
		}
	});
});

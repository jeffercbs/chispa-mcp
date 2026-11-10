import { describe, expect, it } from "vitest";
import { allows } from "../src/domain/access.js";

describe("permisos por rol", () => {
	it("el profesor accede al nivel de equipo pero no al de administrador", () => {
		expect(allows("team", "profesor")).toBe(true);
		expect(allows("manager", "profesor")).toBe(false);
	});

	it("el administrador accede a todo y sin rol solo a lo que no pide aula", () => {
		expect(allows("manager", "administrador")).toBe(true);
		expect(allows("team", null)).toBe(false);
		expect(allows("none", null)).toBe(true);
	});
});

describe("permisos delegables a profesores", () => {
	it("el administrador tiene todos y el profesor solo los que se le dieron", async () => {
		const { allows, resolvePermissions } = await import("../src/domain/access.js");
		expect(allows("accesos", "administrador")).toBe(true);
		expect(allows("accesos", "profesor")).toBe(false);
		expect(allows("accesos", "profesor", resolvePermissions("profesor", { accesos: true }))).toBe(true);
		expect(allows("soporte", "profesor")).toBe(true);
		expect(allows("soporte", "profesor", resolvePermissions("profesor", { soporte: false }))).toBe(false);
		expect(allows("comercio", null)).toBe(false);
	});
});

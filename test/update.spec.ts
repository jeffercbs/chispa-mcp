import { describe, expect, it } from "vitest";
import { isNewer } from "../src/update.js";
import { SESSION_TOOLS } from "../src/tools/session.js";

describe("isNewer", () => {
	it("compara versiones por número, no por texto", () => {
		expect(isNewer("0.6.0", "0.5.0")).toBe(true);
		expect(isNewer("0.10.0", "0.9.0")).toBe(true);
		expect(isNewer("0.5.0", "0.5.0")).toBe(false);
		expect(isNewer("0.4.9", "0.5.0")).toBe(false);
	});
});

describe("herramientas de sesión", () => {
	it("login y logout se pueden usar sin sesión", () => {
		expect(SESSION_TOOLS.map((tool) => [tool.name, tool.public])).toEqual([
			["login", true],
			["logout", true]
		]);
	});
});

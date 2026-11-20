import { describe, expect, it } from "vitest";
import { maskEmail, platformOf } from "../src/domain/platform.js";
import { parseRoster } from "../src/tools/invites.js";

describe("invitaciones", () => {
	it("lee correos con y sin nombre, sin repetir, y separa los no válidos", () => {
		const { rows, invalid } = parseRoster("Ana Pérez, ana@correo.com\nLuis <LUIS@correo.com>\nana@correo.com\nsin correo\nmal@");
		expect(rows).toEqual([
			{ email: "ana@correo.com", fullName: "Ana Pérez" },
			{ email: "luis@correo.com", fullName: "Luis" }
		]);
		expect(invalid).toEqual(["sin correo", "mal@"]);
	});

	it("oculta parte del correo y elige la plataforma del aula", () => {
		expect(maskEmail("andrea@correo.com")).toBe("an••••@correo.com");
		expect(platformOf("fe30e4ec-52e6-4a18-ab19-fb6594b38105", {}).name).toBe("guias_clave");
		expect(platformOf("00000000-0000-4000-8000-000000000000", {}).site).toBe("https://modochispa.com");
	});
});

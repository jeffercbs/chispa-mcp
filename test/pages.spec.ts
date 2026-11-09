import { describe, expect, it } from "vitest";
import { PAGE_HEADERS, type PageKind, renderPage } from "../src/auth/pages.js";

const KINDS: PageKind[] = [
	"success",
	"cancelled",
	"provider_error",
	"invalid_state",
	"missing_code",
	"invalid_host",
	"not_found",
	"method_not_allowed",
	"server_error"
];

describe("páginas del inicio de sesión", () => {
	it("hay una página con su código HTTP para cada caso", () => {
		const statuses = KINDS.map((kind) => renderPage(kind).status);
		expect(statuses).toEqual([200, 400, 400, 400, 400, 421, 404, 405, 500]);
	});

	it("no lleva scripts ni degradados y sí modo oscuro", () => {
		for (const kind of KINDS) {
			const { html } = renderPage(kind);
			expect(html).not.toMatch(/<script|gradient/i);
			expect(html).toContain("prefers-color-scheme:dark");
		}
	});

	it("solo muestra códigos del proveedor que sean seguros", () => {
		expect(renderPage("provider_error", "server_error").html).toContain("Código: server_error");
		expect(renderPage("provider_error", "<img src=x onerror=alert(1)>").html).not.toContain("onerror");
	});

	it("la política de contenido prohíbe todo salvo estilos incrustados", () => {
		expect(PAGE_HEADERS["content-security-policy"]).toContain("default-src 'none'");
	});
});

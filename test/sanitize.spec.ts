import { describe, expect, it } from "vitest";
import { markdown, plainText, richText, text } from "../src/domain/sanitize.js";

describe("sanitizado", () => {
	it("quita etiquetas y caracteres invisibles del texto plano", () => {
		expect(plainText("  <b>Hola</b>\u0007   mundo ", 100)).toBe("Hola mundo");
		expect(plainText("abcdef", 3)).toBe("abc");
	});

	it("quita scripts, manejadores y enlaces peligrosos del Markdown", () => {
		const cleaned = richText('Texto <script>alert(1)</script><img src=x onerror="x()"> [a](javascript:alert(1))', 1000);
		expect(cleaned).not.toContain("script");
		expect(cleaned).not.toContain("onerror");
		expect(cleaned).not.toContain("javascript:");
	});

	it("no acepta contenido vacío tras limpiar", () => {
		expect(markdown(100, "Contenido").safeParse("<script>x</script>").success).toBe(false);
	});

	it("no se deja engañar por etiquetas anidadas ni atributos peligrosos", () => {
		expect(richText("<scr<script>x</script>ipt>alert(1)</scr<script>x</script>ipt>", 500)).not.toMatch(/<script/i);
		expect(richText('<a href="javascript:alert(1)">x</a>', 500)).not.toContain("javascript:");
		expect(richText('<iframe srcdoc="<p>x</p>"></iframe><div onclick="x()">ok</div>', 500)).not.toMatch(/iframe|srcdoc|onclick/i);
		expect(richText("[x](data:text/html;base64,AAAA)", 500)).toBe("[x](#)");
	});

	it("quita caracteres invisibles y de dirección que ocultan texto", () => {
		expect(plainText("a\u200bb\u202ec\ufeffd", 50)).toBe("abcd");
	});

	it("rechaza entradas gigantes antes de procesarlas", () => {
		expect(text(100, "Título").safeParse("x".repeat(5000)).success).toBe(false);
		expect(text(100, "Título").safeParse("x".repeat(100)).success).toBe(true);
	});

	it("conserva los bloques ```svg y limpia el resto", () => {
		const out = richText('<svg onload="x()"></svg>\n\n```svg\n<svg viewBox="0 0 4 4"><circle r="1"/></svg>\n```', 1000);
		expect(out).toContain("```svg\n<svg viewBox");
		expect(out.split("```svg")[0]).not.toContain("<svg");
	});
});

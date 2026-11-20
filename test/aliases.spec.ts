import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aliases, shortenIds } from "../src/domain/aliases.js";
import { id } from "../src/domain/sanitize.js";

const A = "3f2a9c1b-0000-4000-8000-000000000001";
const B = "3f2a9c1b-1111-4000-8000-000000000002";

describe("IDs cortos", () => {
	it("acorta los UUID de la respuesta y los resuelve a la entrada", async () => {
		await aliases.use(undefined, "persona-1");
		const short = shortenIds({ id: A, list: [{ ref: A }], name: "x" }) as { id: string; list: { ref: string }[] };
		expect(short.id).toBe("@3f2a9c1b");
		expect(short.list[0]?.ref).toBe("@3f2a9c1b");
		expect(id("Curso").parse("@3f2a9c1b")).toBe(A);
		expect(id("Curso").parse(A)).toBe(A);
	});

	it("si dos IDs empiezan igual, el segundo recibe un alias más largo", async () => {
		await aliases.use(undefined, "persona-2");
		expect(aliases.alias(A)).toBe("@3f2a9c1b");
		expect(aliases.alias(B)).toBe("@3f2a9c1b1111");
		expect(id("Curso").parse("@3f2a9c1b1111")).toBe(B);
	});

	it("rechaza un alias que no se ha visto en la sesión", async () => {
		await aliases.use(undefined, "persona-3");
		const result = id("Curso").safeParse("@deadbeef");
		expect(result.success).toBe(false);
		expect(JSON.stringify(result.error?.issues)).toContain("vuelve a listar");
	});

	it("recuerda los alias entre procesos y no mezcla personas", async () => {
		const dir = await mkdtemp(join(tmpdir(), "chispa-alias-"));
		await aliases.use(dir, "persona-4");
		aliases.alias(A);
		await new Promise((resolve) => setTimeout(resolve, 600));
		await aliases.use(dir, "otra");
		expect(aliases.resolve("@3f2a9c1b")).toBeNull();
		await aliases.use(dir, "persona-4");
		expect(aliases.resolve("@3f2a9c1b")).toBe(A);
	});
});

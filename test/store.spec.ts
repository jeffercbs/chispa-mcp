import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clearTokens, readCredentials, writeCredentials } from "../src/auth/store.js";

const URL_A = "https://a.supabase.co";

describe("store", () => {
	it("guarda con permisos 0600 y no reutiliza credenciales de otro proyecto", async () => {
		const dir = await mkdtemp(join(tmpdir(), "chispa-mcp-"));
		await writeCredentials(dir, { supabaseUrl: URL_A, tokens: { accessToken: "a", refreshToken: "r", expiresAt: 1 } });
		expect((await stat(join(dir, "credentials.json"))).mode & 0o777).toBe(0o600);
		expect((await readCredentials(dir, URL_A)).tokens?.refreshToken).toBe("r");
		expect((await readCredentials(dir, "https://b.supabase.co")).tokens).toBeUndefined();
	});
	it("cierra sesión sin borrar el cliente registrado", async () => {
		const dir = await mkdtemp(join(tmpdir(), "chispa-mcp-"));
		await writeCredentials(dir, {
			supabaseUrl: URL_A,
			client: { id: "c", redirectUri: "u" },
			tokens: { accessToken: "a", refreshToken: "r", expiresAt: 1 }
		});
		expect(await clearTokens(dir, URL_A)).toBe(true);
		const after = await readCredentials(dir, URL_A);
		expect(after.tokens).toBeUndefined();
		expect(after.client?.id).toBe("c");
	});
	it("cifra el archivo: ni tokens ni URL aparecen en texto plano", async () => {
		const dir = await mkdtemp(join(tmpdir(), "chispa-mcp-"));
		await writeCredentials(dir, { supabaseUrl: URL_A, tokens: { accessToken: "secreto-acceso", refreshToken: "secreto-refresco", expiresAt: 1 } });
		const raw = await readFile(join(dir, "credentials.json"), "utf8");
		expect(raw).not.toContain("secreto");
		expect(raw).not.toContain("supabase.co");
		expect((await stat(join(dir, "vault.key"))).mode & 0o777).toBe(0o600);
	});
	it("un archivo manipulado se trata como sin sesión", async () => {
		const dir = await mkdtemp(join(tmpdir(), "chispa-mcp-"));
		await writeCredentials(dir, { supabaseUrl: URL_A, tokens: { accessToken: "a", refreshToken: "r", expiresAt: 1 } });
		const envelope = JSON.parse(await readFile(join(dir, "credentials.json"), "utf8")) as { data: string };
		envelope.data = Buffer.from("manipulado").toString("base64");
		await writeFile(join(dir, "credentials.json"), JSON.stringify(envelope));
		expect((await readCredentials(dir, URL_A)).tokens).toBeUndefined();
	});
	it("migra un archivo antiguo en texto plano a cifrado", async () => {
		const dir = await mkdtemp(join(tmpdir(), "chispa-mcp-"));
		await writeFile(join(dir, "credentials.json"), JSON.stringify({ supabaseUrl: URL_A, tokens: { accessToken: "plano", refreshToken: "r", expiresAt: 1 } }));
		expect((await readCredentials(dir, URL_A)).tokens?.accessToken).toBe("plano");
		expect(await readFile(join(dir, "credentials.json"), "utf8")).not.toContain("plano");
	});
});

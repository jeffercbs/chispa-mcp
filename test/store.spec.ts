import { mkdtemp, stat } from "node:fs/promises";
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
});

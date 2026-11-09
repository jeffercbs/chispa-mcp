import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type StoredTokens = { accessToken: string; refreshToken: string; expiresAt: number };
export type StoredCredentials = {
	supabaseUrl: string;
	client?: { id: string; redirectUri: string };
	tokens?: StoredTokens;
};

const file = (dir: string) => join(dir, "credentials.json");

export async function readCredentials(dir: string, supabaseUrl: string): Promise<StoredCredentials> {
	try {
		const data = JSON.parse(await readFile(file(dir), "utf8")) as StoredCredentials;
		// Credenciales de otro proyecto no se reutilizan.
		return data.supabaseUrl === supabaseUrl ? data : { supabaseUrl };
	} catch {
		return { supabaseUrl };
	}
}

export async function writeCredentials(dir: string, data: StoredCredentials) {
	await mkdir(dir, { recursive: true, mode: 0o700 });
	await chmod(dir, 0o700).catch(() => undefined);
	const temp = `${file(dir)}.${process.pid}.tmp`;
	await writeFile(temp, JSON.stringify(data), { mode: 0o600 });
	await rename(temp, file(dir));
}

export async function clearTokens(dir: string, supabaseUrl: string) {
	const data = await readCredentials(dir, supabaseUrl);
	if (!data.tokens) return false;
	delete data.tokens;
	await writeCredentials(dir, data);
	return true;
}

export const removeCredentials = (dir: string) => rm(file(dir), { force: true });

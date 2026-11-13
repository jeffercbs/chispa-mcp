import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isEnvelope, open, seal } from "./vault.js";
const file = (dir) => join(dir, "credentials.json");
export async function readCredentials(dir, supabaseUrl) {
    try {
        const parsed = JSON.parse(await readFile(file(dir), "utf8"));
        let data;
        if (isEnvelope(parsed)) {
            data = JSON.parse(await open(dir, parsed));
        }
        else {
            // Archivo anterior en texto plano: se acepta una vez y se vuelve a guardar cifrado.
            data = parsed;
            if (data.supabaseUrl === supabaseUrl)
                await writeCredentials(dir, data).catch(() => undefined);
        }
        // Credenciales de otro proyecto no se reutilizan.
        return data.supabaseUrl === supabaseUrl ? data : { supabaseUrl };
    }
    catch {
        // Ilegible, manipulado o cifrado en otro equipo: se trata como sin sesión (hay que volver a entrar).
        return { supabaseUrl };
    }
}
export async function writeCredentials(dir, data) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700).catch(() => undefined);
    const temp = `${file(dir)}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(await seal(dir, JSON.stringify(data))), { mode: 0o600 });
    await rename(temp, file(dir));
}
export async function clearTokens(dir, supabaseUrl) {
    const data = await readCredentials(dir, supabaseUrl);
    if (!data.tokens)
        return false;
    delete data.tokens;
    await writeCredentials(dir, data);
    return true;
}
export const removeCredentials = (dir) => Promise.all([rm(file(dir), { force: true }), rm(join(dir, "vault.key"), { force: true })]).then(() => undefined);

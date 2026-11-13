import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { hostname, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
/**
 * Cifrado en reposo de las credenciales (AES-256-GCM).
 *
 * La clave se deriva (HKDF-SHA256) de dos secretos independientes:
 *  1. `vault.key`: 32 bytes aleatorios en la carpeta del MCP (0600).
 *  2. El identificador de esta máquina (machine-id / IOPlatformUUID / MachineGuid).
 *
 * Así, un `credentials.json` copiado (copia de seguridad, carpeta sincronizada, repositorio por error)
 * no se puede descifrar en otro equipo, ni siquiera junto con `vault.key`.
 * No protege frente a otro proceso que corra como la misma persona en el mismo equipo: para eso
 * están los permisos 0600/0700 y que los tokens sean de corta vida y revocables.
 */
const run = promisify(execFile);
const VERSION = 1;
const AAD = Buffer.from(`chispa-mcp:credentials:v${VERSION}`);
async function machineId() {
    try {
        if (process.platform === "linux") {
            for (const path of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
                const value = (await readFile(path, "utf8").catch(() => "")).trim();
                if (value)
                    return value;
            }
        }
        else if (process.platform === "darwin") {
            const { stdout } = await run("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { timeout: 3000 });
            const match = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(stdout);
            if (match?.[1])
                return match[1];
        }
        else if (process.platform === "win32") {
            const { stdout } = await run("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { timeout: 3000 });
            const match = /MachineGuid\s+REG_SZ\s+(\S+)/.exec(stdout);
            if (match?.[1])
                return match[1];
        }
    }
    catch {
        // se usa el respaldo
    }
    return `${hostname()}:${userInfo().username}`;
}
async function keyFile(dir) {
    const path = join(dir, "vault.key");
    try {
        const existing = Buffer.from((await readFile(path, "utf8")).trim(), "base64");
        if (existing.length === 32)
            return existing;
    }
    catch {
        // se crea abajo
    }
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700).catch(() => undefined);
    const fresh = randomBytes(32);
    try {
        await writeFile(path, fresh.toString("base64"), { mode: 0o600, flag: "wx" });
        return fresh;
    }
    catch {
        // otro proceso la creó a la vez: se usa la suya
        return Buffer.from((await readFile(path, "utf8")).trim(), "base64");
    }
}
async function deriveKey(dir) {
    const [secret, machine] = await Promise.all([keyFile(dir), machineId()]);
    return Buffer.from(hkdfSync("sha256", secret, Buffer.from(machine), Buffer.from("chispa-mcp:aes-key"), 32));
}
export async function seal(dir, plain) {
    const key = await deriveKey(dir);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(AAD);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return { v: VERSION, alg: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}
export async function open(dir, envelope) {
    const key = await deriveKey(dir);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
}
export const isEnvelope = (value) => typeof value === "object" &&
    value !== null &&
    value.v === VERSION &&
    value.alg === "aes-256-gcm" &&
    typeof value.iv === "string" &&
    typeof value.tag === "string" &&
    typeof value.data === "string";

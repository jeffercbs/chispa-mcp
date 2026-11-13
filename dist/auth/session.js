import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { refreshTokens, TokenError } from "./oauth.js";
import { decodeClaims } from "./pkce.js";
import { clearTokens, readCredentials, writeCredentials } from "./store.js";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MARGIN_SECONDS = 300;
let pending = null;
function toIdentity(token, expiresAt) {
    const claims = decodeClaims(token);
    if (!claims || typeof claims.sub !== "string" || !UUID.test(claims.sub) || claims.is_anonymous === true)
        return null;
    return { userId: claims.sub, clientId: typeof claims.client_id === "string" ? claims.client_id : null, token, expiresAt };
}
/** Errores que de verdad significan «esta sesión ya no sirve»; un fallo de red u otro no borra nada. */
const DEAD_SESSION = new Set(["invalid_grant", "invalid_token", "invalid_request", "refresh_token_not_found", "refresh_token_already_used", "no_client"]);
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 15_000;
/** Varios clientes de IA pueden arrancar este servidor a la vez: solo uno renueva y los demás reutilizan el resultado. */
async function withRefreshLock(dir, task) {
    const lock = join(dir, "refresh.lock");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const started = Date.now();
    for (;;) {
        try {
            await mkdir(lock);
            break;
        }
        catch {
            const age = await stat(lock).then((info) => Date.now() - info.mtimeMs, () => 0);
            if (age > LOCK_STALE_MS || Date.now() - started > LOCK_WAIT_MS)
                await rm(lock, { recursive: true, force: true });
            else
                await new Promise((resolve) => setTimeout(resolve, 150));
        }
    }
    try {
        return await task();
    }
    finally {
        await rm(lock, { recursive: true, force: true });
    }
}
async function load(config) {
    const stored = await readCredentials(config.dir, config.url);
    const tokens = stored.tokens;
    if (!tokens)
        return null;
    const now = Math.floor(Date.now() / 1000);
    if (tokens.expiresAt - now > MARGIN_SECONDS)
        return toIdentity(tokens.accessToken, tokens.expiresAt);
    return withRefreshLock(config.dir, async () => {
        // Otro proceso pudo renovar mientras esperábamos el turno.
        const latest = await readCredentials(config.dir, config.url);
        if (!latest.tokens)
            return null;
        if (latest.tokens.expiresAt - Math.floor(Date.now() / 1000) > MARGIN_SECONDS) {
            return toIdentity(latest.tokens.accessToken, latest.tokens.expiresAt);
        }
        try {
            const fresh = await refreshTokens(config, latest.tokens.refreshToken);
            await writeCredentials(config.dir, { ...latest, tokens: fresh });
            return toIdentity(fresh.accessToken, fresh.expiresAt);
        }
        catch (error) {
            // Solo una sesión realmente revocada o vencida obliga a entrar de nuevo; los fallos de red conservan las credenciales.
            if (error instanceof TokenError && DEAD_SESSION.has(error.message))
                await clearTokens(config.dir, config.url);
            return null;
        }
    });
}
/** Devuelve la identidad vigente (renovando el token si hace falta) o null si no hay sesión. */
export function currentIdentity(config) {
    pending ??= load(config).finally(() => {
        pending = null;
    });
    return pending;
}

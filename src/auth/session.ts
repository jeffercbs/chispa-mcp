import type { Config } from "../config.js";
import type { Identity } from "./identity.js";
import { refreshTokens, TokenError } from "./oauth.js";
import { decodeClaims } from "./pkce.js";
import { clearTokens, readCredentials, writeCredentials } from "./store.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MARGIN_SECONDS = 60;

let pending: Promise<Identity | null> | null = null;

function toIdentity(token: string, expiresAt: number): Identity | null {
	const claims = decodeClaims(token);
	if (!claims || typeof claims.sub !== "string" || !UUID.test(claims.sub) || claims.is_anonymous === true) return null;
	return { userId: claims.sub, clientId: typeof claims.client_id === "string" ? claims.client_id : null, token, expiresAt };
}

async function load(config: Config): Promise<Identity | null> {
	const stored = await readCredentials(config.dir, config.url);
	const tokens = stored.tokens;
	if (!tokens) return null;
	const now = Math.floor(Date.now() / 1000);
	if (tokens.expiresAt - now > MARGIN_SECONDS) return toIdentity(tokens.accessToken, tokens.expiresAt);

	try {
		const fresh = await refreshTokens(config, tokens.refreshToken);
		await writeCredentials(config.dir, { ...stored, tokens: fresh });
		return toIdentity(fresh.accessToken, fresh.expiresAt);
	} catch (error) {
		// Sesión revocada o vencida: hay que iniciar sesión de nuevo. Un fallo de red conserva las credenciales.
		if (error instanceof TokenError) await clearTokens(config.dir, config.url);
		return null;
	}
}

/** Devuelve la identidad vigente (renovando el token si hace falta) o null si no hay sesión. */
export function currentIdentity(config: Config): Promise<Identity | null> {
	pending ??= load(config).finally(() => {
		pending = null;
	});
	return pending;
}

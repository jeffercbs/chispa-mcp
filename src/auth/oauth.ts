import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { Config } from "../config.js";
import { LIMITS } from "../limits.js";
import { PAGE_HEADERS, type PageKind, renderPage } from "./pages.js";
import { challengeFor, createVerifier, decodeClaims, randomState } from "./pkce.js";
import { readCredentials, type StoredTokens, writeCredentials } from "./store.js";

type Endpoints = { authorize: string; token: string; register: string };

async function discover(config: Config): Promise<Endpoints> {
	const fallback: Endpoints = {
		authorize: `${config.url}/auth/v1/oauth/authorize`,
		token: `${config.url}/auth/v1/oauth/token`,
		register: `${config.url}/auth/v1/oauth/clients/register`
	};
	let found = fallback;
	try {
		const response = await fetch(`${config.url}/.well-known/oauth-authorization-server/auth/v1`, {
			signal: AbortSignal.timeout(LIMITS.networkMs)
		});
		if (response.ok) {
			const meta = (await response.json()) as Record<string, unknown>;
			found = {
				authorize: typeof meta.authorization_endpoint === "string" ? meta.authorization_endpoint : fallback.authorize,
				token: typeof meta.token_endpoint === "string" ? meta.token_endpoint : fallback.token,
				register: typeof meta.registration_endpoint === "string" ? meta.registration_endpoint : fallback.register
			};
		}
	} catch {
		// se usan las rutas estándar de Supabase
	}
	// Nunca enviar credenciales a un servidor distinto al proyecto.
	const origin = new URL(config.url).origin;
	for (const value of Object.values(found)) {
		if (new URL(value).origin !== origin) throw new Error("Los metadatos OAuth apuntan fuera del proyecto.");
	}
	return found;
}

async function ensureClient(config: Config, endpoints: Endpoints, redirectUri: string) {
	const stored = await readCredentials(config.dir, config.url);
	if (stored.client?.redirectUri === redirectUri) return stored.client.id;
	const response = await fetch(endpoints.register, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			client_name: "Chispa MCP (local)",
			redirect_uris: [redirectUri],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none"
		}),
		signal: AbortSignal.timeout(LIMITS.networkMs)
	});
	if (!response.ok)
		throw new Error("No se pudo registrar el cliente OAuth. ¿Está activado el servidor OAuth de Supabase con registro dinámico?");
	const body = (await response.json()) as { client_id?: string };
	if (!body.client_id) throw new Error("Supabase no devolvió client_id.");
	await writeCredentials(config.dir, { ...stored, client: { id: body.client_id, redirectUri } });
	return body.client_id;
}

async function requestTokens(endpoint: string, params: Record<string, string>): Promise<StoredTokens> {
	const response = await fetch(endpoint, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
		body: new URLSearchParams(params),
		signal: AbortSignal.timeout(LIMITS.networkMs)
	});
	const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
	if (!response.ok || typeof body.access_token !== "string" || typeof body.refresh_token !== "string") {
		throw new TokenError(typeof body.error === "string" ? body.error : "token_error");
	}
	const claims = decodeClaims(body.access_token);
	const expiresAt = typeof claims?.exp === "number" ? claims.exp : Math.floor(Date.now() / 1000) + Number(body.expires_in ?? 3600);
	return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt };
}

export class TokenError extends Error {}

export async function refreshTokens(config: Config, refreshToken: string): Promise<StoredTokens> {
	const stored = await readCredentials(config.dir, config.url);
	if (!stored.client) throw new TokenError("no_client");
	const endpoints = await discover(config);
	return requestTokens(endpoints.token, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: stored.client.id });
}

function openBrowser(url: string) {
	const [command, args]: [string, string[]] =
		process.platform === "darwin"
			? ["open", [url]]
			: process.platform === "win32"
				? ["rundll32", ["url.dll,FileProtocolHandler", url]]
				: ["xdg-open", [url]];
	try {
		const child = spawn(command, args, { stdio: "ignore", detached: true });
		child.on("error", () => undefined);
		child.unref();
	} catch {
		// la URL también se imprime
	}
}

export type LoginFlow = {
	/** Dirección que la persona debe abrir (el navegador ya se intentó abrir solo). */
	url: string;
	/** Se resuelve cuando la persona aprueba y los tokens quedan guardados; se rechaza si cancela o se agota el tiempo. */
	finished: Promise<void>;
};

/** Prepara el inicio de sesión y deja el servidor local escuchando; no espera a que la persona apruebe. */
export async function beginLogin(config: Config): Promise<LoginFlow> {
	const endpoints = await discover(config);
	const redirectUri = `http://127.0.0.1:${config.port}/callback`;
	const clientId = await ensureClient(config, endpoints, redirectUri);
	const verifier = createVerifier();
	const state = randomState();

	const authorizeUrl = new URL(endpoints.authorize);
	authorizeUrl.search = new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: redirectUri,
		scope: "openid email profile",
		state,
		code_challenge: challengeFor(verifier),
		code_challenge_method: "S256"
	}).toString();

	let resolveListening!: () => void;
	let rejectListening!: (error: Error) => void;
	const listening = new Promise<void>((resolve, reject) => {
		resolveListening = resolve;
		rejectListening = reject;
	});
	const codePromise = new Promise<string>((resolve, reject) => {
		const reply = (res: import("node:http").ServerResponse, kind: PageKind, detail?: string) => {
			const page = renderPage(kind, detail);
			res.writeHead(page.status, PAGE_HEADERS).end(page.html);
		};
		const allowedHosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);
		const server = createServer((req, res) => {
			try {
				// Defensa contra DNS rebinding: solo atendemos a nuestra propia dirección local.
				if (!allowedHosts.has(String(req.headers.host ?? "").toLowerCase())) return reply(res, "invalid_host");
				const url = new URL(req.url ?? "/", redirectUri);
				if (url.pathname !== "/callback") return reply(res, "not_found");
				if (req.method !== "GET") return reply(res, "method_not_allowed");

				const done = (error: Error | null, value?: string) => {
					clearTimeout(timer);
					server.close();
					if (error) reject(error);
					else resolve(value as string);
				};
				if (url.searchParams.get("state") !== state) {
					reply(res, "invalid_state");
					return done(new Error("El estado OAuth no coincide: se descartó el inicio de sesión."));
				}
				const problem = url.searchParams.get("error");
				if (problem) {
					reply(res, problem === "access_denied" ? "cancelled" : "provider_error", problem);
					return done(
						new Error(problem === "access_denied" ? "Cancelaste la autorización." : "El servidor de cuentas rechazó la solicitud.")
					);
				}
				const returned = url.searchParams.get("code");
				if (!returned) {
					reply(res, "missing_code");
					return done(new Error("La respuesta llegó sin código de autorización."));
				}
				reply(res, "success");
				done(null, returned);
			} catch {
				reply(res, "server_error");
			}
		});
		const timer = setTimeout(() => {
			server.close();
			reject(new Error("Se agotó el tiempo esperando la autorización."));
		}, config.loginTimeoutMinutes * 60_000);
		server.on("error", (error: NodeJS.ErrnoException) => {
			clearTimeout(timer);
			const failure =
				error.code === "EADDRINUSE" ? new Error(`El puerto ${config.port} está ocupado. Usa CHISPA_MCP_PORT con otro puerto.`) : error;
			rejectListening(failure);
			reject(failure);
		});
		server.listen(config.port, "127.0.0.1", () => {
			openBrowser(authorizeUrl.toString());
			resolveListening();
		});
	});
	codePromise.catch(() => undefined);
	await listening;

	const finished = codePromise.then(async (code) => {
		const tokens = await requestTokens(endpoints.token, {
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
			client_id: clientId,
			code_verifier: verifier
		});
		const stored = await readCredentials(config.dir, config.url);
		await writeCredentials(config.dir, { ...stored, tokens });
	});
	return { url: authorizeUrl.toString(), finished };
}

/** Inicio de sesión desde la terminal: muestra la dirección y espera a que la persona apruebe. */
export async function login(config: Config, log: (message: string) => void): Promise<void> {
	const flow = await beginLogin(config);
	log("Abre esta dirección para autorizar el acceso con tu cuenta de docente:\n");
	log(`  ${flow.url}\n`);
	await flow.finished;
}

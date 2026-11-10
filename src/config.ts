import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CURRENCY } from "./limits.js";

export type Config = {
	url: string;
	anonKey: string;
	port: number;
	dir: string;
	/** Moneda en la que se muestran los importes (los precios de la plataforma están en esta moneda). */
	currency: string;
	/** Segundos que se recuerda el rol de la persona en un aula. 0 = consultar siempre. */
	roleCacheSeconds: number;
	/** Escrituras permitidas por minuto antes de pedir calma (protege de bucles del modelo). */
	writesPerMinute: number;
	/** Minutos que espera el inicio de sesión. */
	loginTimeoutMinutes: number;
};

// La URL y la clave publicable de Supabase son públicas por diseño: la seguridad real es RLS.
const DEFAULT_URL = "https://gcvychpnivksfflbqifi.supabase.co";
const DEFAULT_KEY = "sb_publishable_kn9lXuBWyWi0-PF2n82FgA_LIT1ohmp";
const DEFAULT_PORT = 53682;

function bounded(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number) {
	const raw = env[name];
	if (raw === undefined || raw === "") return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} debe ser un entero entre ${min} y ${max}.`);
	return value;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const url = (env.CHISPA_SUPABASE_URL?.trim() || DEFAULT_URL).replace(/\/+$/, "");
	if (!url.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)) {
		throw new Error("CHISPA_SUPABASE_URL debe ser una URL https.");
	}
	const port = Number(env.CHISPA_MCP_PORT ?? DEFAULT_PORT);
	if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("CHISPA_MCP_PORT debe estar entre 1024 y 65535.");
	const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
	const currency = (env.CHISPA_CURRENCY?.trim() || DEFAULT_CURRENCY).toUpperCase();
	if (!/^[A-Z]{3}$/.test(currency)) throw new Error("CHISPA_CURRENCY debe ser un código de 3 letras, por ejemplo COP.");
	return {
		url,
		anonKey: env.CHISPA_SUPABASE_ANON_KEY?.trim() || DEFAULT_KEY,
		port,
		dir: env.CHISPA_MCP_HOME || join(base, "chispa-mcp"),
		currency,
		roleCacheSeconds: bounded(env, "CHISPA_ROLE_CACHE_SECONDS", 20, 0, 300),
		writesPerMinute: bounded(env, "CHISPA_WRITES_PER_MINUTE", 120, 10, 10_000),
		loginTimeoutMinutes: bounded(env, "CHISPA_LOGIN_TIMEOUT_MINUTES", 5, 1, 30)
	};
}

import { spawn } from "node:child_process";
import { LIMITS } from "./limits.js";
import { VERSION } from "./version.js";

const REMOTE = "https://raw.githubusercontent.com/jeffercbs/chispa-mcp/main/package.json";
export const PACKAGE_SPEC = "github:jeffercbs/chispa-mcp";

let latest: string | null = null;

const parts = (version: string) => version.split(".").map((part) => Number.parseInt(part, 10) || 0);

export function isNewer(candidate: string, current: string) {
	const [a, b] = [parts(candidate), parts(current)];
	for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
	return false;
}

/** Versión nueva detectada en esta sesión (o null). */
export const pendingUpdate = () => (latest && isNewer(latest, VERSION) ? latest : null);

/**
 * Busca una versión nueva y, si la hay, deja lista la descarga para el próximo arranque
 * (npx vuelve a resolver el repositorio con --prefer-online). No toca el proceso en marcha.
 */
export async function checkForUpdate(): Promise<void> {
	if (process.env.CHISPA_MCP_NO_UPDATE === "1") return;
	try {
		const response = await fetch(REMOTE, { signal: AbortSignal.timeout(LIMITS.networkMs) });
		if (!response.ok) return;
		const body = (await response.json()) as { version?: unknown };
		if (typeof body.version !== "string" || !/^\d+\.\d+\.\d+$/.test(body.version)) return;
		latest = body.version;
		if (!pendingUpdate()) return;
		console.error(JSON.stringify({ event: "mcp.update", from: VERSION, to: latest }));
		const child = spawn("npx", ["-y", "--prefer-online", PACKAGE_SPEC, "--version"], { stdio: "ignore", detached: true, shell: process.platform === "win32" });
		child.on("error", () => undefined);
		child.unref();
	} catch {
		// sin red: se intenta de nuevo en el próximo arranque
	}
}

import { readFileSync } from "node:fs";

/** Versión del paquete, leída de su package.json (así nunca se desfasa del número publicado). */
export const VERSION: string = (() => {
	try {
		const parsed = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown };
		return typeof parsed.version === "string" ? parsed.version : "0.0.0";
	} catch {
		return "0.0.0";
	}
})();

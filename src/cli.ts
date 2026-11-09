#!/usr/bin/env node
import { login } from "./auth/oauth.js";
import { currentIdentity } from "./auth/session.js";
import { clearTokens } from "./auth/store.js";
import { readConfig } from "./config.js";
import { userClient } from "./domain/supabase.js";
import { SERVER_INFO } from "./mcp/protocol.js";
import { serve } from "./stdio.js";

const HELP = `Chispa MCP ${SERVER_INFO.version}

Uso: chispa-mcp [comando]

  (sin comando)  Inicia el servidor MCP por stdio (lo que ejecuta tu cliente de IA)
  login          Inicia sesión en el navegador con tu cuenta de docente
  whoami         Muestra la cuenta conectada
  logout         Borra la sesión guardada en este equipo
`;

async function main() {
	const command = process.argv[2] ?? "serve";
	if (command === "--help" || command === "-h" || command === "help") return console.log(HELP);
	if (command === "--version" || command === "-v") return console.log(SERVER_INFO.version);

	const config = readConfig();

	if (command === "serve") return serve(config);

	if (command === "login") {
		await login(config, (message) => console.log(message));
		const identity = await currentIdentity(config);
		const { data } = identity ? await userClient(config, identity.token).auth.getUser(identity.token) : { data: null };
		console.log(`Sesión iniciada${data?.user?.email ? ` como ${data.user.email}` : ""}. Ya puedes usar Chispa MCP desde tu cliente de IA.`);
		return;
	}

	if (command === "whoami") {
		const identity = await currentIdentity(config);
		if (!identity) return console.log("Sin sesión. Ejecuta: chispa-mcp login");
		const { data } = await userClient(config, identity.token).auth.getUser(identity.token);
		return console.log(data?.user?.email ?? identity.userId);
	}

	if (command === "logout") {
		const removed = await clearTokens(config.dir, config.url);
		return console.log(
			removed
				? "Sesión cerrada en este equipo. Para revocar el acceso del todo, hazlo desde tu cuenta de Chispa."
				: "No había sesión guardada."
		);
	}

	console.error(`Comando desconocido: ${command}\n\n${HELP}`);
	process.exitCode = 1;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : "Error inesperado.");
	process.exit(1);
});

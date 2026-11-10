/** Flujos guiados que el cliente puede ofrecer como atajos. El texto guía al modelo; no ejecuta nada. */
type Prompt = {
	name: string;
	title: string;
	description: string;
	arguments: { name: string; description: string; required: boolean }[];
	text: (args: Record<string, string>) => string;
};

const PROMPTS: Prompt[] = [
	{
		name: "cargar_simulacro",
		title: "Cargar un simulacro",
		description: "Crea un examen o simulacro completo a partir de preguntas que pegues o describas.",
		arguments: [{ name: "tema", description: "Tema o módulo del simulacro", required: false }],
		text: ({ tema }) =>
			`Quiero cargar un simulacro${tema ? ` sobre «${tema}»` : ""}. Guíame paso a paso: 1) identifica el aula, el curso y el módulo con las herramientas de lectura; 2) pídeme las preguntas (o redáctalas conmigo) y revisa que cada una tenga una única respuesta correcta y una explicación; 3) valida todo con import_exam en dry_run=true y muéstrame un resumen; 4) con mi confirmación, cárgalo en borrador; 5) verifica con get_exam y dime cómo publicarlo.`
	},
	{
		name: "crear_curso_completo",
		title: "Montar un curso desde cero",
		description: "Crea curso, módulos y lecciones con quiz y tarjetas, todo en borrador.",
		arguments: [{ name: "tema", description: "De qué trata el curso", required: true }],
		text: ({ tema }) =>
			`Quiero montar un curso sobre «${tema ?? "…"}». Hazme las preguntas mínimas (público, nivel, número de módulos), propón una estructura y espera mi visto bueno. Luego crea el curso con create_course, los módulos con create_module y las lecciones con import_module_content (usa dry_run primero). Deja todo en borrador y al final resume qué hay y qué falta para publicar.`
	},
	{
		name: "revisar_grupo",
		title: "Revisar el avance del grupo",
		description: "Resume quién va bien, quién se está quedando atrás y qué hacer.",
		arguments: [{ name: "dias", description: "Días de inactividad que te preocupan", required: false }],
		text: ({ dias }) =>
			`Revisa el avance de mi grupo con classroom_progress${dias ? ` (inactividad de ${dias} días o más)` : ""}. Dime en tono claro: 1) cómo va el grupo en general, 2) a quién conviene escribir primero y por qué, 3) lecciones donde se atoran. Si hay chats sin responder (list_waiting_chats), menciónalos. No envíes mensajes sin que yo los apruebe.`
	},
	{
		name: "descuento_por_grupo",
		title: "Configurar el descuento por grupo",
		description: "Revisa y ajusta el descuento por cantidad de personas de un curso.",
		arguments: [{ name: "curso", description: "Nombre del curso", required: false }],
		text: ({ curso }) =>
			`Quiero revisar el descuento por grupo${curso ? ` de «${curso}»` : " de mis cursos"}. Usa get_group_pricing y muéstrame, en una tabla corta, el descuento y el total para 2, 3, 4 y 5 personas. Si quiero cambiarlo, propón porcentajes que no bajen al sumar personas, enséñame cómo quedarían los precios y aplica set_group_pricing solo cuando yo confirme.`
	},
	{
		name: "atender_solicitudes",
		title: "Atender solicitudes y chats",
		description: "Repasa solicitudes de ingreso y conversaciones pendientes.",
		arguments: [],
		text: () =>
			"Repasa las solicitudes pendientes (list_access_requests) y los chats sin responder (list_waiting_chats). Para cada uno resume la situación en una línea y propón qué hacer; redacta las respuestas pero NO las envíes ni apruebes nada hasta que yo lo confirme uno por uno."
	}
];

export function listPrompts() {
	return PROMPTS.map(({ text: _text, ...rest }) => rest);
}

export type PromptResult =
	| { ok: false; message: string }
	| { ok: true; description: string; messages: { role: "user"; content: { type: "text"; text: string } }[] };

export function getPrompt(name: unknown, args: unknown): PromptResult | null {
	const prompt = PROMPTS.find((item) => item.name === name);
	if (!prompt) return null;
	const given: Record<string, string> = {};
	if (args && typeof args === "object")
		for (const [key, value] of Object.entries(args)) if (typeof value === "string") given[key] = value.slice(0, 200);
	const missing = prompt.arguments.filter((argument) => argument.required && !given[argument.name]);
	if (missing.length > 0) return { ok: false, message: `Falta: ${missing.map((argument) => argument.name).join(", ")}.` };
	return { ok: true, description: prompt.description, messages: [{ role: "user", content: { type: "text", text: prompt.text(given) } }] };
}

import { z } from "zod";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { defined, id, optionalText, plainText, text } from "../domain/sanitize.js";
import { checkFormulaItem, MAX_EXPRESSION } from "../domain/formula.js";
import { findElement, PERIODIC_ASKS } from "../domain/periodic-table.js";
import { defineTool } from "../mcp/tool.js";
import { nextPosition, ownedSession, ownedSessionRow } from "./ownership.js";

const clean = (max: number) =>
	z
		.string()
		.transform((value) => plainText(value, max))
		.pipe(z.string().min(1));
const soft = (max: number) =>
	z
		.string()
		.optional()
		.transform((value) => (value ? plainText(value, max) || undefined : undefined));
const key = z
	.string()
	.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
	.max(60);

const pairs = (min: number, max: number) =>
	z.object({
		pairs: z
			.array(z.object({ left: clean(200), right: clean(300) }))
			.min(min)
			.max(max)
	});
const words = z.object({
	items: z
		.array(z.object({ text: clean(40), clue: soft(200) }))
		.min(3)
		.max(30)
});

const range = z
	.object({ min: z.number().min(-1_000_000).max(1_000_000), max: z.number().min(-1_000_000).max(1_000_000), step: z.number().positive().optional() })
	.refine((value) => value.min <= value.max, { error: "El mínimo no puede ser mayor que el máximo." });

const formulaItem = z
	.object({
		text: clean(400),
		answer: clean(MAX_EXPRESSION),
		vars: z.record(z.string().regex(/^[a-z][a-z0-9]{0,3}$/i), range).optional(),
		mode: z.enum(["escribir", "elegir"]).optional(),
		decimals: z.number().int().min(0).max(6).optional(),
		tolerance: z.number().min(0).max(1_000_000).optional(),
		unit: soft(20),
		why: soft(400)
	})
	.superRefine((item, context) => {
		const problem = checkFormulaItem(item);
		if (problem) context.addIssue({ code: "custom", message: problem });
	});

const periodicItem = z.object({
	element: clean(40).refine((value) => findElement(value) !== null, { error: "Elemento desconocido: usa nombre, símbolo o número atómico." }),
	ask: z.enum(PERIODIC_ASKS),
	why: soft(400)
});

// Mismos mínimos y máximos que el editor de juegos de la plataforma.
const CONFIGS = {
	clasificar: z
		.object({
			buckets: z
				.array(z.object({ key, label: clean(80) }))
				.min(2)
				.max(6),
			items: z
				.array(z.object({ text: clean(200), bucket: key, why: soft(400) }))
				.min(3)
				.max(60)
		})
		.refine((value) => value.items.every((item) => value.buckets.some((bucket) => bucket.key === item.bucket)), {
			error: "Cada tarjeta debe ir en una columna existente."
		}),
	ordenar: z.object({
		items: z
			.array(z.object({ text: clean(200), label: soft(60), order: z.number().int().min(1).max(100) }))
			.min(3)
			.max(30)
	}),
	emparejar: pairs(3, 30),
	memoria: pairs(3, 10),
	verdadero_falso: z.object({
		items: z
			.array(z.object({ text: clean(300), answer: z.boolean(), why: soft(400) }))
			.min(3)
			.max(60)
	}),
	completar: z.object({
		items: z
			.array(
				z.object({
					text: clean(300).refine((value) => value.includes("___"), { error: "Cada frase necesita su hueco (___)." }),
					answer: clean(80),
					options: z.array(clean(80)).max(8).optional(),
					why: soft(400)
				})
			)
			.min(3)
			.max(40)
	}),
	sopa: words,
	descifrar: words,
	tabla_periodica: z.object({ items: z.array(periodicItem).min(3).max(60) }),
	formula: z.object({ items: z.array(formulaItem).min(3).max(40) })
} as const;

const KINDS = Object.keys(CONFIGS) as [keyof typeof CONFIGS, ...(keyof typeof CONFIGS)[]];

const FORMS = [
	"clasificar: {buckets:[{key,label}] (2-6), items:[{text,bucket,why?}] (3-60)}",
	"ordenar: {items:[{text,label?,order}] (3-30)}",
	"emparejar: {pairs:[{left,right}] (3-30)}",
	"memoria: {pairs:[{left,right}] (3-10)}",
	"verdadero_falso: {items:[{text,answer,why?}] (3-60)}",
	"completar: {items:[{text con ___, answer, options?, why?}] (3-40)}",
	"sopa y descifrar: {items:[{text,clue?}] (3-30)}",
	"tabla_periodica: {items:[{element (nombre, símbolo o número), ask: ubicar|simbolo|nombre|numero|categoria, why?}] (3-60)}",
	"formula: {items:[{text con {a} y $LaTeX$, answer (expresión: a+b, a*b, a/b, a^2, sqrt(a), pi*r^2), vars?:{a:{min,max,step?}}, mode?: escribir|elegir, decimals?, tolerance?, unit?, why?}] (3-40)}"
].join("; ");

export const saveGame = defineTool({
	name: "save_game",
	title: "Crear o editar un juego",
	description: `Crea un juego interactivo en una lección o edita uno existente (envía game_id). El config depende del tipo: ${FORMS}. Queda en borrador salvo que se publique.`,
	level: "team",
	readOnly: false,
	input: z.object({
		classroom_id: id("Aula"),
		session_id: id("Lección"),
		game_id: id("Juego a editar").optional(),
		kind: z.enum(KINDS).describe("Tipo de juego"),
		title: text(160, "Título"),
		prompt: optionalText(400, "Consigna"),
		config: z.record(z.string(), z.unknown()).describe("Configuración según el tipo"),
		published: z.boolean().default(false),
		position: z.number().int().min(1).max(10_000).optional()
	}),
	async run({ db, actor }, input) {
		await ownedSession(db, actor, input.classroom_id, input.session_id);
		const parsed = CONFIGS[input.kind].safeParse(input.config);
		if (!parsed.success) throw new ToolError(`El juego no cumple los mínimos: ${parsed.error.issues[0]?.message ?? "revisa el config"}.`);

		const row = defined({
			session_id: input.session_id,
			kind: input.kind,
			title: input.title,
			prompt: input.prompt,
			config: parsed.data,
			is_published: input.published,
			position:
				input.position ?? (input.game_id ? undefined : await nextPosition(db, "interactive_activities", "session_id", input.session_id))
		});
		if (input.game_id) {
			const { data } = await db.from("interactive_activities").select("session_id").eq("id", input.game_id).maybeSingle();
			if ((data as { session_id: string } | null)?.session_id !== input.session_id) throw new ToolError(NOT_FOUND);
			const { error } = await db.from("interactive_activities").update(row).eq("id", input.game_id);
			if (error) throw new ToolError("No pudimos guardar el juego.");
			return { game_id: input.game_id, published: input.published };
		}
		const { data, error } = await db.from("interactive_activities").insert(row).select("id").single();
		if (error || !data) throw new ToolError("No pudimos guardar el juego.");
		return { game_id: (data as { id: string }).id, published: input.published };
	}
});

export const getGame = defineTool({
	name: "get_game",
	title: "Detalle de un juego",
	description: "Devuelve el tipo, la consigna y la configuración completa de un juego de una lección.",
	level: "team",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula"), game_id: id("Juego") }),
	async run({ db, actor }, input) {
		await ownedSessionRow(db, actor, input.classroom_id, "interactive_activities", input.game_id);
		const { data } = await db
			.from("interactive_activities")
			.select("id, session_id, kind, title, prompt, config, is_published, position")
			.eq("id", input.game_id)
			.maybeSingle();
		if (!data) throw new ToolError(NOT_FOUND);
		return data as Record<string, unknown>;
	}
});

export const deleteGame = defineTool({
	name: "delete_game",
	title: "Borrar juego",
	description: "Borra un juego interactivo de una lección.",
	level: "team",
	readOnly: false,
	destructive: true,
	input: z.object({ classroom_id: id("Aula"), game_id: id("Juego") }),
	async run({ db, actor }, input) {
		await ownedSessionRow(db, actor, input.classroom_id, "interactive_activities", input.game_id);
		const { error } = await db.from("interactive_activities").delete().eq("id", input.game_id);
		if (error) throw new ToolError("No pudimos borrar el juego.");
		return { deleted: true };
	}
});

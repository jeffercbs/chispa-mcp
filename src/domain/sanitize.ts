import { z } from "zod";

import { LIMITS } from "../limits.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: justamente se buscan caracteres de control para eliminarlos
const INVISIBLE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200b-\u200f\u2028\u2029\u2060-\u2064\ufeff\p{Bidi_Control}]/gu;
const BLOCKED_ELEMENTS =
	/<\s*(script|style|iframe|object|embed|form|link|meta|base|svg|math|template|frame|frameset|applet|noscript)\b[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi;
const BLOCKED_TAGS = /<\s*\/?\s*(script|style|iframe|object|embed|form|link|meta|base|template|frame|frameset|applet|noscript)\b[^>]*>?/gi;
const INLINE_HANDLERS = /[\s/"'`]on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const DANGEROUS_ATTRS = /\s(srcdoc|formaction|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const SCRIPT_LINKS = /\]\(\s*(javascript|vbscript|data|file):[^)]*\)/gi;
const SCRIPT_ATTR_URLS =
	/\s(href|src|action)\s*=\s*("\s*(javascript|vbscript|data|file):[^"]*"|'\s*(javascript|vbscript|data|file):[^']*'|(javascript|vbscript|data|file):[^\s>]*)/gi;
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

const decode = (value: string) => value.replace(/&(amp|lt|gt|quot|#39);/g, (match) => ENTITIES[match] ?? match);
const clean = (value: string) => value.normalize("NFC").replace(/\r\n?/g, "\n").replace(INVISIBLE, "");

/** Texto plano: sin etiquetas, comentarios ni caracteres de control. */
export function plainText(input: string, max: number) {
	const stripped = input
		.replace(/<\s*(script|style)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<\/?[a-zA-Z][^>]*>/g, "");
	return clean(decode(stripped))
		.replace(/\xa0/g, " ")
		.replace(/[^\S\n]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()
		.slice(0, max);
}

const SVG_FENCE = /(```svg[ \t]*\n[\s\S]*?\n```)/g;

function stripActive(input: string) {
	let value = input;
	// Repite hasta que no cambie: evita reconstruir etiquetas con trozos anidados («<scr<script>ipt>»).
	for (let pass = 0; pass < 4; pass++) {
		const next = value
			.replace(/<!--[\s\S]*?-->/g, "")
			.replace(BLOCKED_ELEMENTS, "")
			.replace(BLOCKED_TAGS, "")
			.replace(INLINE_HANDLERS, "")
			.replace(DANGEROUS_ATTRS, "")
			.replace(SCRIPT_ATTR_URLS, "")
			.replace(SCRIPT_LINKS, "](#)");
		if (next === value) break;
		value = next;
	}
	return value;
}

/**
 * Markdown/HTML básico: se conserva el formato, se quitan elementos activos. Los bloques ```svg
 * (ilustraciones de las presentaciones) se respetan y la plataforma los limpia al mostrarlos.
 */
export function richText(input: string, max: number) {
	const value = clean(input)
		.split(SVG_FENCE)
		.map((part, index) => (index % 2 === 1 ? part : stripActive(part)))
		.join("");
	return value.trim().slice(0, max);
}

/** Tope de entrada previo a sanear: un texto gigante se rechaza, no se procesa. */
const ceiling = (max: number) => Math.min(max * 4 + 64, LIMITS.richText * 4);

export const text = (max: number, description: string) =>
	z
		.string()
		.max(ceiling(max), { error: `${description}: es demasiado largo.` })
		.describe(description)
		.transform((value) => plainText(value, max))
		.pipe(z.string().min(1, { error: `${description}: no puede estar vacío.` }));

export const optionalText = (max: number, description: string) =>
	z
		.string()
		.max(ceiling(max), { error: `${description}: es demasiado largo.` })
		.describe(description)
		.optional()
		.transform((value) => (value ? plainText(value, max) || null : null));

export const markdown = (max: number, description: string) =>
	z
		.string()
		.max(ceiling(max), { error: `${description}: es demasiado largo.` })
		.describe(description)
		.transform((value) => richText(value, max))
		.pipe(z.string().min(1, { error: `${description}: no puede estar vacío.` }));

export const id = (description: string) => z.uuid({ error: `${description}: no es un identificador válido.` }).describe(description);

export function slugify(value: string, max = 40) {
	return (
		value
			.normalize("NFD")
			.replace(/\p{Diacritic}/gu, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, max)
			.replace(/-+$/g, "") || "modulo"
	);
}

export function slugWithCode(value: string) {
	const code = [...crypto.getRandomValues(new Uint8Array(3))]
		.map((byte) => byte.toString(36).padStart(2, "0"))
		.join("")
		.slice(0, 4);
	return `${slugify(value)}-${code}`;
}

/** Campo de texto para actualizaciones: omitido = sin cambios; vacío = borrar. */
export const patchText = (max: number, description: string) =>
	z
		.string()
		.max(ceiling(max), { error: `${description}: es demasiado largo.` })
		.describe(`${description} (omítelo para no cambiarlo; "" lo borra)`)
		.optional()
		.transform((value) => (value === undefined ? undefined : plainText(value, max) || null));

export const patchMarkdown = (max: number, description: string) =>
	z
		.string()
		.max(ceiling(max), { error: `${description}: es demasiado largo.` })
		.describe(`${description} (omítelo para no cambiarlo; "" lo borra)`)
		.optional()
		.transform((value) => (value === undefined ? undefined : richText(value, max) || null));

export const optionalMarkdown = (max: number, description: string) =>
	z
		.string()
		.max(ceiling(max), { error: `${description}: es demasiado largo.` })
		.describe(description)
		.optional()
		.transform((value) => (value ? richText(value, max) || null : null));

/** Quita las claves indefinidas para armar un UPDATE parcial. */
export function defined<T extends Record<string, unknown>>(values: T): Partial<T> {
	return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}

export function youtubeUrl(input: string): string | null {
	const raw = input.trim();
	if (!raw) return null;
	const match = /^[\w-]{11}$/.test(raw)
		? [raw, raw]
		: [/youtu\.be\/([\w-]{11})/, /[?&]v=([\w-]{11})/, /\/embed\/([\w-]{11})/, /\/shorts\/([\w-]{11})/, /\/live\/([\w-]{11})/]
				.map((pattern) => raw.match(pattern))
				.find(Boolean);
	return match?.[1] ? `https://www.youtube.com/watch?v=${match[1]}` : null;
}

export const isSlug = (value: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) && value.length <= 80;

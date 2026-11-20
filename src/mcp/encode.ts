type Scalar = string | number | boolean;

export const RAW_TEXT = "__text";

export const rawText = (text: string) => ({ [RAW_TEXT]: text });

const isScalar = (value: unknown): value is Scalar => ["string", "number", "boolean"].includes(typeof value);
const isEmpty = (value: unknown) =>
	value === null ||
	value === undefined ||
	value === "" ||
	(Array.isArray(value) && value.length === 0) ||
	(typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0);
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const inline = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n");
const cell = (value: string) => inline(value).replace(/\|/g, "\\|");

function scalarText(value: Scalar, inTable: boolean) {
	if (typeof value !== "string") return String(value);
	return inTable ? cell(value) : inline(value);
}

function cellText(value: unknown): string {
	if (isEmpty(value)) return "";
	if (isScalar(value)) return scalarText(value, true);
	if (Array.isArray(value) && value.every(isScalar)) return value.map((item) => cell(String(item)).replace(/;/g, "\\;")).join("; ");
	return cell(JSON.stringify(value));
}

function tableColumns(items: unknown[]) {
	if (items.length < 2 || !items.every(isPlainObject)) return null;
	const columns: string[] = [];
	for (const item of items as Record<string, unknown>[]) {
		for (const [key, value] of Object.entries(item)) {
			if (isEmpty(value)) continue;
			if (!isScalar(value) && !(Array.isArray(value) && value.every(isScalar))) return null;
			if (!columns.includes(key)) columns.push(key);
		}
	}
	return columns.length > 0 ? columns : null;
}

function encodeArray(key: string, items: unknown[], pad: string, out: string[]) {
	if (items.every(isScalar)) {
		out.push(`${pad}${key}[${items.length}]: ${items.map((item) => scalarText(item as Scalar, true)).join(" | ")}`);
		return;
	}
	const columns = tableColumns(items);
	if (columns) {
		out.push(`${pad}${key}[${items.length}]{${columns.join(",")}}:`);
		for (const item of items as Record<string, unknown>[])
			out.push(`${pad}  ${columns.map((column) => cellText(item[column])).join(" | ")}`);
		return;
	}
	out.push(`${pad}${key}[${items.length}]:`);
	for (const item of items) {
		if (isPlainObject(item)) {
			const lines: string[] = [];
			encodeObject(item, `${pad}    `, lines);
			if (lines.length === 0) continue;
			out.push(`${pad}  - ${(lines[0] ?? "").trimStart()}`, ...lines.slice(1));
		} else {
			out.push(`${pad}  - ${isScalar(item) ? scalarText(item, false) : JSON.stringify(item)}`);
		}
	}
}

function encodeObject(value: Record<string, unknown>, pad: string, out: string[]) {
	for (const [key, item] of Object.entries(value)) {
		if (isEmpty(item)) continue;
		if (isScalar(item)) out.push(`${pad}${key}: ${scalarText(item, false)}`);
		else if (Array.isArray(item)) encodeArray(key, item, pad, out);
		else if (isPlainObject(item)) {
			out.push(`${pad}${key}:`);
			encodeObject(item, `${pad}  `, out);
		}
	}
}

/**
 * Texto compacto para el modelo: «clave: valor», listas uniformes como tabla con cabecera
 * «clave[n]{col1,col2}:» y una fila por elemento separada por « | ». Omite vacíos y nulos.
 */
export function encode(value: unknown): string {
	if (isPlainObject(value) && typeof value[RAW_TEXT] === "string") return value[RAW_TEXT] as string;
	if (isScalar(value)) return String(value);
	const out: string[] = [];
	if (Array.isArray(value)) encodeArray("items", value, "", out);
	else if (isPlainObject(value)) encodeObject(value, "", out);
	return out.join("\n") || "ok";
}

export function compactJson(value: unknown): string {
	return JSON.stringify(value, (_key, item) => (item === null || item === undefined || item === "" ? undefined : item));
}

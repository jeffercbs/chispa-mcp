import type { Actor } from "../domain/access.js";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import type { Db } from "../domain/supabase.js";
import { ownedCourses } from "./ownership.js";

export const ITEM_KINDS = [
	"exam_question",
	"quiz_question",
	"self_check",
	"flashcard",
	"scenario_criterion",
	"game",
	"lesson",
	"module",
	"theme"
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

type Link = Record<string, unknown> | Record<string, unknown>[] | null | undefined;
const one = (value: Link) => (Array.isArray(value) ? value[0] : value) ?? undefined;
const nested = (row: Record<string, unknown>, ...path: string[]) => {
	let current: Record<string, unknown> | undefined = row;
	for (const key of path) current = one(current?.[key] as Link);
	return current;
};

type KindSpec = {
	table: string;
	parent: string;
	chain: string;
	course: (row: Record<string, unknown>) => string | undefined;
	module?: (row: Record<string, unknown>) => string | undefined;
};

const viaSession: Omit<KindSpec, "table"> = {
	parent: "session_id",
	chain: "session_id, sessions!inner(module_id, modules!inner(course_id))",
	course: (row) => nested(row, "sessions", "modules")?.course_id as string | undefined,
	module: (row) => nested(row, "sessions")?.module_id as string | undefined
};

export const KINDS: Record<ItemKind, KindSpec> = {
	exam_question: {
		table: "exam_questions",
		parent: "exam_id",
		chain: "exam_id, exams!inner(module_id, modules!inner(course_id))",
		course: (row) => nested(row, "exams", "modules")?.course_id as string | undefined,
		module: (row) => nested(row, "exams")?.module_id as string | undefined
	},
	quiz_question: { table: "quiz_questions", ...viaSession },
	self_check: { table: "session_questions", ...viaSession },
	game: { table: "interactive_activities", ...viaSession },
	flashcard: { table: "flashcards", parent: "session_id", chain: "session_id, course_id", course: (row) => row.course_id as string },
	scenario_criterion: {
		table: "scenario_criteria",
		parent: "scenario_id",
		chain: "scenario_id, scenarios!inner(module_id, modules!inner(course_id))",
		course: (row) => nested(row, "scenarios", "modules")?.course_id as string | undefined,
		module: (row) => nested(row, "scenarios")?.module_id as string | undefined
	},
	lesson: {
		table: "sessions",
		parent: "module_id",
		chain: "module_id, modules!inner(course_id)",
		course: (row) => nested(row, "modules")?.course_id as string | undefined,
		module: (row) => row.module_id as string
	},
	module: { table: "modules", parent: "course_id", chain: "course_id", course: (row) => row.course_id as string },
	theme: { table: "course_themes", parent: "course_id", chain: "course_id", course: (row) => row.course_id as string }
};

export type OwnedRow = Record<string, unknown> & { id: string; courseId: string; moduleId?: string };

/**
 * Trae en UNA consulta las filas pedidas con su curso, y comprueba el permiso una sola vez por
 * curso distinto. Falla si falta alguna (no existe o no se tiene acceso).
 */
export async function ownedRows(db: Db, actor: Actor, classroomId: string, kind: ItemKind, ids: string[], columns = "") {
	const spec = KINDS[kind];
	const unique = [...new Set(ids)];
	const select = ["id", spec.chain, columns].filter(Boolean).join(", ");
	const { data, error } = await db.from(spec.table).select(select).in("id", unique);
	if (error) throw new ToolError("No pudimos leer los elementos.");
	const rows = new Map<string, OwnedRow>();
	for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
		const courseId = spec.course(row);
		if (!courseId) continue;
		rows.set(row.id as string, { ...row, id: row.id as string, courseId, moduleId: spec.module?.(row) });
	}
	const missing = unique.filter((item) => !rows.has(item));
	if (missing.length > 0)
		throw new ToolError(`${NOT_FOUND} (${missing.length} de ${unique.length})`, "Vuelve a listar para obtener los IDs actuales.");
	await ownedCourses(
		db,
		actor,
		classroomId,
		[...rows.values()].map((row) => row.courseId)
	);
	return rows;
}

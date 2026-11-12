import type { Actor } from "../domain/access.js";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import type { Db } from "../domain/supabase.js";
import { courseInClassroom, requireCourseInClassroom } from "./shared.js";

const NOT_EDITOR = "No tienes permiso para editar este curso.";
const NOT_OWNER = "Solo quien creó el curso puede hacer esto.";

/**
 * Mismo criterio que la UI (`can_edit_course`): dueño del curso, administrador del aula
 * donde está vinculado o profesor con acceso a él. El curso debe estar en el aula indicada.
 */
export async function ownedCourse(db: Db, _actor: Actor, classroomId: string, courseId: string) {
	// Las dos comprobaciones son independientes: se lanzan juntas y se evalúan en orden.
	const [inRoom, editable] = await Promise.all([
		courseInClassroom(db, classroomId, courseId),
		db.rpc("can_edit_course", { course: courseId })
	]);
	if (!inRoom && !(editable.data === true && (await isLibrary(db, courseId)))) throw new ToolError(NOT_FOUND);
	if (editable.data !== true) throw new ToolError(NOT_EDITOR);
	return { courseId };
}

/** Las bibliotecas de módulos compartidos no están vinculadas a un aula: se editan con el permiso del curso. */
async function isLibrary(db: Db, courseId: string) {
	const { data } = await db.from("courses").select("is_library").eq("id", courseId).maybeSingle();
	return (data as { is_library: boolean } | null)?.is_library === true;
}

/** Acciones reservadas a quien creó el curso (borrar, transferir, mover de colección). */
export async function creatorCourse(db: Db, actor: Actor, classroomId: string, courseId: string) {
	await requireCourseInClassroom(db, classroomId, courseId);
	const { data } = await db.from("courses").select("owner_id").eq("id", courseId).maybeSingle();
	if (!data) throw new ToolError(NOT_FOUND);
	if ((data as { owner_id: string | null }).owner_id !== actor.userId) throw new ToolError(NOT_OWNER);
	return { courseId };
}

export async function ownedModule(db: Db, actor: Actor, classroomId: string, moduleId: string) {
	const { data } = await db.from("modules").select("course_id").eq("id", moduleId).maybeSingle();
	const courseId = (data as { course_id: string } | null)?.course_id;
	if (!courseId) throw new ToolError(NOT_FOUND);
	await ownedCourse(db, actor, classroomId, courseId);
	return { moduleId, courseId };
}

type Chain = { module_id: string; modules: { course_id: string } | { course_id: string }[] | null };
const courseOf = (modules: Chain["modules"]) => (Array.isArray(modules) ? modules[0] : modules)?.course_id;

/** Lección → módulo → curso en una sola consulta (la relación se resuelve en la base de datos). */
export async function ownedSession(db: Db, actor: Actor, classroomId: string, sessionId: string) {
	const { data } = await db.from("sessions").select("module_id, modules!inner(course_id)").eq("id", sessionId).maybeSingle();
	const row = data as Chain | null;
	const courseId = row && courseOf(row.modules);
	if (!row || !courseId) throw new ToolError(NOT_FOUND);
	await ownedCourse(db, actor, classroomId, courseId);
	return { sessionId, moduleId: row.module_id, courseId };
}

/** Resuelve la lección dueña de una fila hija (quiz, autoevaluación, juego) y comprueba permiso. */
export async function ownedSessionRow(
	db: Db,
	actor: Actor,
	classroomId: string,
	table: "quiz_questions" | "session_questions" | "interactive_activities",
	rowId: string
) {
	const { data } = await db
		.from(table)
		.select("session_id, sessions!inner(module_id, modules!inner(course_id))")
		.eq("id", rowId)
		.maybeSingle();
	const row = data as { session_id: string; sessions: Chain | Chain[] | null } | null;
	const chain = Array.isArray(row?.sessions) ? row?.sessions[0] : row?.sessions;
	const courseId = chain && courseOf(chain.modules);
	if (!row || !chain || !courseId) throw new ToolError(NOT_FOUND);
	await ownedCourse(db, actor, classroomId, courseId);
	return { sessionId: row.session_id, moduleId: chain.module_id, courseId };
}

type Positioned =
	| "modules"
	| "sessions"
	| "quiz_questions"
	| "flashcards"
	| "exam_questions"
	| "scenario_criteria"
	| "course_themes"
	| "interactive_activities"
	| "session_questions";

export async function nextPosition(db: Db, table: Positioned, column: string, parentId: string) {
	const { data } = await db.from(table).select("position").eq(column, parentId).order("position", { ascending: false }).limit(1);
	return ((data as { position: number }[] | null)?.[0]?.position ?? 0) + 1;
}

/** Aplica un orden completo: `ids` debe ser exactamente el conjunto de hijos del padre. */
export async function applyOrder(db: Db, table: "modules" | "sessions", column: string, parentId: string, ids: string[]) {
	const { data } = await db.from(table).select("id").eq(column, parentId);
	const existing = new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
	if (new Set(ids).size !== ids.length || ids.length !== existing.size || ids.some((item) => !existing.has(item))) {
		throw new ToolError("La lista debe incluir todos los elementos, sin repetir ni añadir otros.");
	}
	const results = await Promise.all(
		ids.map((item, index) =>
			db
				.from(table)
				.update({ position: index + 1, number: index + 1 })
				.eq("id", item)
		)
	);
	if (results.some((result) => result.error)) throw new ToolError("No pudimos guardar el orden.");
}

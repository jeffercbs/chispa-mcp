import { NOT_FOUND, ToolError } from "../domain/errors.js";
import type { Db } from "../domain/supabase.js";
import { LIMITS } from "../limits.js";

export async function classroomCourseIds(db: Db, classroomId: string) {
	const { data } = await db.from("classroom_courses").select("course_id").eq("classroom_id", classroomId);
	return ((data ?? []) as { course_id: string }[]).map((row) => row.course_id);
}

/** Una consulta puntual, sin traer todos los cursos del aula. */
export async function courseInClassroom(db: Db, classroomId: string, courseId: string) {
	const { data } = await db
		.from("classroom_courses")
		.select("course_id")
		.eq("classroom_id", classroomId)
		.eq("course_id", courseId)
		.maybeSingle();
	return Boolean(data);
}

export async function requireCourseInClassroom(db: Db, classroomId: string, courseId: string) {
	if (!(await courseInClassroom(db, classroomId, courseId))) throw new ToolError(NOT_FOUND);
}

export async function profileNames(db: Db, ids: string[]) {
	if (ids.length === 0) return new Map<string, string>();
	const { data } = await db.from("profiles").select("id, full_name").in("id", ids);
	return new Map(
		((data ?? []) as { id: string; full_name: string | null }[]).map((row) => [row.id, row.full_name?.trim() || "Sin nombre"])
	);
}

export const daysSince = (iso: string | null) =>
	iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : null;

/** Inserta en tandas para no enviar consultas gigantes; devuelve cuántas filas entraron. */
export async function insertChunks(db: Db, table: string, rows: Record<string, unknown>[], failure: string) {
	for (let start = 0; start < rows.length; start += LIMITS.insertChunk) {
		const { error } = await db.from(table).insert(rows.slice(start, start + LIMITS.insertChunk));
		if (error) throw new ToolError(failure, start > 0 ? `Se guardaron ${start} de ${rows.length} antes del fallo.` : undefined);
	}
	return rows.length;
}

import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { LIMITS } from "../limits.js";
export async function classroomCourseIds(db, classroomId) {
    const { data } = await db.from("classroom_courses").select("course_id").eq("classroom_id", classroomId);
    return (data ?? []).map((row) => row.course_id);
}
/** Una consulta puntual, sin traer todos los cursos del aula. */
export async function courseInClassroom(db, classroomId, courseId) {
    const { data } = await db
        .from("classroom_courses")
        .select("course_id")
        .eq("classroom_id", classroomId)
        .eq("course_id", courseId)
        .maybeSingle();
    return Boolean(data);
}
export async function requireCourseInClassroom(db, classroomId, courseId) {
    if (!(await courseInClassroom(db, classroomId, courseId)))
        throw new ToolError(NOT_FOUND);
}
export async function profileNames(db, ids) {
    if (ids.length === 0)
        return new Map();
    const { data } = await db.from("profiles").select("id, full_name").in("id", ids);
    return new Map((data ?? []).map((row) => [row.id, row.full_name?.trim() || "Sin nombre"]));
}
export const daysSince = (iso) => iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : null;
/** Inserta en tandas para no enviar consultas gigantes; devuelve cuántas filas entraron. */
export async function insertChunks(db, table, rows, failure) {
    for (let start = 0; start < rows.length; start += LIMITS.insertChunk) {
        const { error } = await db.from(table).insert(rows.slice(start, start + LIMITS.insertChunk));
        if (error)
            throw new ToolError(failure, start > 0 ? `Se guardaron ${start} de ${rows.length} antes del fallo.` : undefined);
    }
    return rows.length;
}

import { NOT_FOUND, ToolError } from "../domain/errors.js";
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
];
const one = (value) => (Array.isArray(value) ? value[0] : value) ?? undefined;
const nested = (row, ...path) => {
    let current = row;
    for (const key of path)
        current = one(current?.[key]);
    return current;
};
const viaSession = {
    parent: "session_id",
    chain: "session_id, sessions!inner(module_id, modules!inner(course_id))",
    course: (row) => nested(row, "sessions", "modules")?.course_id,
    module: (row) => nested(row, "sessions")?.module_id
};
export const KINDS = {
    exam_question: {
        table: "exam_questions",
        parent: "exam_id",
        chain: "exam_id, exams!inner(module_id, modules!inner(course_id))",
        course: (row) => nested(row, "exams", "modules")?.course_id,
        module: (row) => nested(row, "exams")?.module_id
    },
    quiz_question: { table: "quiz_questions", ...viaSession },
    self_check: { table: "session_questions", ...viaSession },
    game: { table: "interactive_activities", ...viaSession },
    flashcard: { table: "flashcards", parent: "session_id", chain: "session_id, course_id", course: (row) => row.course_id },
    scenario_criterion: {
        table: "scenario_criteria",
        parent: "scenario_id",
        chain: "scenario_id, scenarios!inner(module_id, modules!inner(course_id))",
        course: (row) => nested(row, "scenarios", "modules")?.course_id,
        module: (row) => nested(row, "scenarios")?.module_id
    },
    lesson: {
        table: "sessions",
        parent: "module_id",
        chain: "module_id, modules!inner(course_id)",
        course: (row) => nested(row, "modules")?.course_id,
        module: (row) => row.module_id
    },
    module: { table: "modules", parent: "course_id", chain: "course_id", course: (row) => row.course_id },
    theme: { table: "course_themes", parent: "course_id", chain: "course_id", course: (row) => row.course_id }
};
/**
 * Trae en UNA consulta las filas pedidas con su curso, y comprueba el permiso una sola vez por
 * curso distinto. Falla si falta alguna (no existe o no se tiene acceso).
 */
export async function ownedRows(db, actor, classroomId, kind, ids, columns = "") {
    const spec = KINDS[kind];
    const unique = [...new Set(ids)];
    const select = ["id", spec.chain, columns].filter(Boolean).join(", ");
    const { data, error } = await db.from(spec.table).select(select).in("id", unique);
    if (error)
        throw new ToolError("No pudimos leer los elementos.");
    const rows = new Map();
    for (const row of (data ?? [])) {
        const courseId = spec.course(row);
        if (!courseId)
            continue;
        rows.set(row.id, { ...row, id: row.id, courseId, moduleId: spec.module?.(row) });
    }
    const missing = unique.filter((item) => !rows.has(item));
    if (missing.length > 0)
        throw new ToolError(`${NOT_FOUND} (${missing.length} de ${unique.length})`, "Vuelve a listar para obtener los IDs actuales.");
    await ownedCourses(db, actor, classroomId, [...rows.values()].map((row) => row.courseId));
    return rows;
}

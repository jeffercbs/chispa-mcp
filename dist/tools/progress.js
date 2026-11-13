import { z } from "zod";
import { id } from "../domain/sanitize.js";
import { LIMITS } from "../limits.js";
import { defineTool } from "../mcp/tool.js";
import { daysSince, profileNames } from "./shared.js";
export const classroomProgress = defineTool({
    name: "classroom_progress",
    title: "Avance del grupo",
    description: "Resume el avance de cada estudiante del aula: lecciones completadas, quizzes aprobados, puntos y días sin actividad. Puede filtrar a quienes llevan inactivos.",
    level: "team",
    readOnly: true,
    input: z.object({
        classroom_id: id("Aula"),
        inactive_days: z.number().int().min(1).max(365).optional().describe("Solo quienes llevan al menos estos días sin actividad"),
        limit: z
            .number()
            .int()
            .min(1)
            .max(LIMITS.pageMax)
            .default(LIMITS.pageDefault)
            .describe("Cuántos estudiantes devolver (los más inactivos primero)")
    }),
    async run({ db }, input) {
        const { data } = await db.rpc("classroom_student_summary", { room: input.classroom_id });
        const rows = (data ?? []);
        const names = await profileNames(db, rows.map((row) => row.user_id));
        const students = rows
            .map((row) => ({
            name: names.get(row.user_id) ?? "Sin nombre",
            lessons_done: row.sessions_done,
            quizzes_passed: row.quizzes_passed,
            points: row.points,
            days_inactive: daysSince(row.last_activity)
        }))
            .filter((row) => !input.inactive_days || row.days_inactive === null || row.days_inactive >= input.inactive_days)
            .sort((a, b) => (b.days_inactive ?? 9999) - (a.days_inactive ?? 9999));
        return { total: rows.length, shown: Math.min(students.length, input.limit), students: students.slice(0, input.limit) };
    }
});

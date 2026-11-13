import { z } from "zod";
import { describeIssues, parseQuestionLines } from "../domain/bulk.js";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { id, markdown, optionalText, text } from "../domain/sanitize.js";
import { LIMITS } from "../limits.js";
import { defineTool } from "../mcp/tool.js";
import { nextPosition, ownedModule } from "./ownership.js";
import { insertChunks } from "./shared.js";
const repeat = {
    repeatable: z.boolean().default(false).describe("Si se puede repetir cada cierto tiempo"),
    repeat_days: z.number().int().min(1).max(365).default(7).describe("Días entre intentos si es repetible"),
    max_attempts: z.number().int().min(1).max(50).optional().describe("Máximo de intentos si es repetible"),
    pass_percent: z.number().int().min(1).max(100).default(60).describe("Porcentaje para aprobar")
};
const repeatColumns = (input) => ({
    repeat_mode: input.repeatable ? "periodico" : "una_vez",
    repeat_days: input.repeatable ? input.repeat_days : null,
    max_attempts: input.repeatable ? (input.max_attempts ?? null) : null,
    pass_percent: input.pass_percent
});
export async function ownedParent(db, actor, classroomId, table, itemId) {
    const { data } = await db.from(table).select("module_id").eq("id", itemId).maybeSingle();
    const moduleId = data?.module_id;
    if (!moduleId)
        throw new ToolError(NOT_FOUND);
    return ownedModule(db, actor, classroomId, moduleId);
}
export const createExam = defineTool({
    name: "create_exam",
    title: "Crear simulacro o examen",
    description: "Crea un simulacro o examen al final de un módulo de un curso que puedes editar. Queda en borrador; añade preguntas con add_exam_questions.",
    level: "team",
    readOnly: false,
    input: z.object({
        classroom_id: id("Aula"),
        module_id: id("Módulo"),
        title: text(160, "Título"),
        description: optionalText(2000, "Instrucciones"),
        time_limit_minutes: z.number().int().min(1).max(600).optional().describe("Tiempo límite en minutos"),
        review_mode: z.enum(["resultado", "explicaciones", "completa"]).default("explicaciones").describe("Qué ve el estudiante al terminar"),
        ...repeat
    }),
    async run({ db, actor }, input) {
        await ownedModule(db, actor, input.classroom_id, input.module_id);
        const { data, error } = await db
            .from("exams")
            .insert({
            module_id: input.module_id,
            title: input.title,
            description: input.description,
            is_published: false,
            ...repeatColumns(input),
            repeat_hours: null,
            time_limit_minutes: input.time_limit_minutes ?? null,
            review_mode: input.review_mode,
            practice_enabled: false,
            practice_min: 5,
            practice_max: null
        })
            .select("id")
            .single();
        if (error || !data)
            throw new ToolError("No pudimos crear el examen.");
        return { exam_id: data.id, published: false };
    }
});
export const examQuestion = z
    .object({
    prompt: text(1000, "Pregunta"),
    options: z.array(text(500, "Opción")).min(2).max(6),
    correct: z.number().int().min(1).max(6).describe("Número de la opción correcta, desde 1"),
    explanation: optionalText(2000, "Explicación"),
    topic: optionalText(80, "Tema"),
    lesson_number: z.number().int().min(1).max(500).optional().describe("Número de la lección del módulo que conviene repasar")
})
    .refine((item) => item.correct <= item.options.length, { error: "La opción correcta está fuera de rango." });
/** Une las preguntas en JSON y en texto compacto; valida todo antes de guardar nada. */
export function collectQuestions(input) {
    const out = [...(input.questions ?? [])];
    if (input.questions_text) {
        const { questions, issues, lines } = parseQuestionLines(input.questions_text, LIMITS.bulkQuestions);
        const invalid = [...issues];
        questions.forEach((raw, index) => {
            const parsed = examQuestion.safeParse(raw);
            if (parsed.success)
                out.push(parsed.data);
            else
                invalid.push({ line: lines[index] ?? index + 1, message: parsed.error.issues[0]?.message ?? "Pregunta no válida." });
        });
        if (invalid.length > 0) {
            throw new ToolError(`Hay errores en las preguntas (no se guardó nada):\n${describeIssues(invalid.sort((a, b) => a.line - b.line), LIMITS.issuesShown)}`, "Corrige esas líneas y vuelve a enviar toda la carga.");
        }
    }
    if (out.length === 0)
        throw new ToolError("No hay preguntas para cargar.", "Envía `questions` (JSON) o `questions_text` (una pregunta por línea).");
    if (out.length > LIMITS.bulkQuestions)
        throw new ToolError(`Máximo ${LIMITS.bulkQuestions} preguntas por llamada.`, "Divide la carga en varias llamadas.");
    return out;
}
/** Convierte las preguntas en filas, resolviendo «lesson_number» contra las lecciones reales del módulo. */
export async function questionRows(db, moduleId, examId, items, start) {
    const { data: sessions } = await db.from("sessions").select("id, number").eq("module_id", moduleId);
    const byNumber = new Map((sessions ?? []).map((row) => [row.number, row.id]));
    const missing = [
        ...new Set(items.map((item) => item.lesson_number).filter((number) => number !== undefined && !byNumber.has(number)))
    ];
    if (missing.length > 0) {
        throw new ToolError(`El módulo no tiene la(s) lección(es) número ${missing.join(", ")}.`, "Revisa los números con get_course_outline o quita «lección:».");
    }
    return items.map((item, index) => ({
        exam_id: examId,
        prompt: item.prompt,
        options: item.options,
        correct_index: item.correct - 1,
        explanation: item.explanation,
        topic: item.topic,
        session_id: item.lesson_number ? (byNumber.get(item.lesson_number) ?? null) : null,
        position: start + index
    }));
}
export const addExamQuestions = defineTool({
    name: "add_exam_questions",
    title: "Cargar preguntas en un examen",
    description: `Carga preguntas de opción múltiple en un simulacro o examen (hasta ${LIMITS.bulkQuestions} por llamada). Envía \`questions\` (JSON) o \`questions_text\` (una por línea: «enunciado | opción | *correcta | opción | explicación: … | tema: … | lección: 2»). Es todo o nada: si una pregunta falla no se guarda ninguna y se indica la línea. Usa dry_run=true para validar sin guardar. Con replace=true sustituye todas las existentes (confirma antes con la persona).`,
    level: "team",
    readOnly: false,
    input: z
        .object({
        classroom_id: id("Aula"),
        exam_id: id("Examen"),
        questions: z.array(examQuestion).max(LIMITS.bulkQuestions).optional().describe("Preguntas en JSON"),
        questions_text: z.string().max(400_000).optional().describe("Preguntas en texto compacto, una por línea"),
        replace: z.boolean().default(false).describe("true borra primero todas las preguntas actuales"),
        dry_run: z.boolean().default(false).describe("true solo valida y muestra qué se guardaría")
    })
        .refine((input) => (input.questions?.length ?? 0) > 0 || Boolean(input.questions_text?.trim()), {
        error: "Envía `questions` o `questions_text`."
    }),
    async run({ db, actor }, input) {
        const { moduleId } = await ownedParent(db, actor, input.classroom_id, "exams", input.exam_id);
        const items = collectQuestions(input);
        const { count } = await db.from("exam_questions").select("id", { count: "exact", head: true }).eq("exam_id", input.exam_id);
        const existing = input.replace ? 0 : (count ?? 0);
        if (existing + items.length > LIMITS.examQuestions) {
            throw new ToolError(`Un examen admite hasta ${LIMITS.examQuestions} preguntas (tiene ${existing}).`, "Divide en otro examen o usa replace.");
        }
        const start = input.replace ? 1 : await nextPosition(db, "exam_questions", "exam_id", input.exam_id);
        const rows = await questionRows(db, moduleId, input.exam_id, items, start);
        if (input.dry_run) {
            return {
                dry_run: true,
                valid: true,
                would_add: items.length,
                total_after: existing + items.length,
                replaces_existing: input.replace ? (count ?? 0) : 0,
                preview: items.slice(0, 3).map((item) => item.prompt)
            };
        }
        if (input.replace) {
            const { error } = await db.from("exam_questions").delete().eq("exam_id", input.exam_id);
            if (error)
                throw new ToolError("No pudimos reemplazar las preguntas.");
        }
        await insertChunks(db, "exam_questions", rows, "No pudimos guardar las preguntas.");
        return { added: items.length, total: existing + items.length };
    }
});
export const createScenario = defineTool({
    name: "create_scenario",
    title: "Crear escenario",
    description: "Crea un caso práctico de respuesta abierta al final de un módulo de un curso que puedes editar. Queda en borrador; añade su rúbrica con add_scenario_criteria.",
    level: "team",
    readOnly: false,
    input: z.object({
        classroom_id: id("Aula"),
        module_id: id("Módulo"),
        title: text(160, "Título"),
        situation: markdown(8000, "Situación que se debe resolver"),
        question: optionalText(2000, "Qué se pide concretamente"),
        model_answer: markdown(8000, "Respuesta de referencia"),
        min_chars: z.number().int().min(20).max(2000).default(80).describe("Mínimo de caracteres de la respuesta"),
        ...repeat
    }),
    async run({ db, actor }, input) {
        await ownedModule(db, actor, input.classroom_id, input.module_id);
        const { data, error } = await db
            .from("scenarios")
            .insert({
            module_id: input.module_id,
            title: input.title,
            situation: input.situation,
            question: input.question,
            is_published: false,
            ...repeatColumns(input),
            min_chars: input.min_chars
        })
            .select("id")
            .single();
        if (error || !data)
            throw new ToolError("No pudimos crear el escenario.");
        const scenarioId = data.id;
        const { error: solutionError } = await db
            .from("scenario_solutions")
            .upsert({ scenario_id: scenarioId, model_answer: input.model_answer, feedback_pass: null, feedback_fail: null });
        if (solutionError)
            throw new ToolError("Creamos el escenario, pero no pudimos guardar la respuesta de referencia.");
        return { scenario_id: scenarioId, published: false };
    }
});
export const addScenarioCriteria = defineTool({
    name: "add_scenario_criteria",
    title: "Añadir criterios a la rúbrica",
    description: "Añade criterios de autoevaluación a un escenario de un curso que puedes editar.",
    level: "team",
    readOnly: false,
    input: z.object({
        classroom_id: id("Aula"),
        scenario_id: id("Escenario"),
        criteria: z
            .array(z.object({
            label: text(500, "Qué debe contener una buena respuesta"),
            if_met: optionalText(600, "Mensaje si lo cumple"),
            if_missed: optionalText(600, "Pista si no lo cumple"),
            topic: optionalText(80, "Tema"),
            weight: z.number().int().min(1).max(5).default(1).describe("Peso de 1 a 5")
        }))
            .min(1)
            .max(20)
    }),
    async run({ db, actor }, input) {
        await ownedParent(db, actor, input.classroom_id, "scenarios", input.scenario_id);
        const start = await nextPosition(db, "scenario_criteria", "scenario_id", input.scenario_id);
        const { error } = await db.from("scenario_criteria").insert(input.criteria.map((item, index) => ({
            scenario_id: input.scenario_id,
            label: item.label,
            if_met: item.if_met,
            if_missed: item.if_missed,
            topic: item.topic,
            session_id: null,
            weight: item.weight,
            position: start + index
        })));
        if (error)
            throw new ToolError("No pudimos guardar los criterios.");
        return { added: input.criteria.length };
    }
});

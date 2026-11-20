import { z } from "zod";
import { aliases, isAlias, isUuid } from "../domain/aliases.js";
import { parseQuestionLines } from "../domain/bulk.js";
import { ToolError } from "../domain/errors.js";
import { id, markdown, patchMarkdown, patchText, text } from "../domain/sanitize.js";
import { ENUMS, LIMITS } from "../limits.js";
import { defineTool } from "../mcp/tool.js";
import { ownedParent } from "./evaluations.js";
import { ITEM_KINDS, KINDS, ownedRows } from "./item-kinds.js";
import { inBatches, nextPosition, ownedSession } from "./ownership.js";
const EDITABLE = ["exam_question", "quiz_question", "self_check", "flashcard", "scenario_criterion", "lesson", "module"];
const optionList = (max) => z.array(text(max, "Opción")).min(2).max(6);
const correct = z.number().int().min(1).max(6);
const PATCHES = {
    exam_question: z.object({
        prompt: text(1000, "Enunciado").optional(),
        options: optionList(500).optional(),
        correct: correct.optional(),
        explanation: patchText(2000, "Explicación"),
        topic: patchText(80, "Tema"),
        lesson: z.number().int().min(0).max(500).optional()
    }),
    quiz_question: z.object({
        prompt: text(1000, "Enunciado").optional(),
        options: optionList(300).optional(),
        correct: correct.optional(),
        explanation: patchText(1000, "Explicación"),
        difficulty: z.number().int().min(1).max(5).optional()
    }),
    self_check: z.object({ question: markdown(2000, "Pregunta").optional(), answer: markdown(4000, "Respuesta").optional() }),
    flashcard: z.object({
        front: text(600, "Anverso").optional(),
        back: text(2000, "Reverso").optional(),
        published: z.boolean().optional()
    }),
    scenario_criterion: z.object({
        label: text(500, "Criterio").optional(),
        if_met: patchText(600, "Mensaje si lo cumple"),
        if_missed: patchText(600, "Pista si no lo cumple"),
        topic: patchText(80, "Tema"),
        weight: z.number().int().min(1).max(5).optional()
    }),
    lesson: z.object({
        title: text(200, "Título").optional(),
        summary: patchText(600, "Resumen"),
        key_idea: patchText(400, "Idea clave"),
        format: z.enum(ENUMS.sessionFormat).optional(),
        content: patchMarkdown(LIMITS.richText, "Contenido"),
        published: z.boolean().optional()
    }),
    module: z.object({
        title: text(200, "Título").optional(),
        objective: patchText(1000, "Objetivo"),
        published: z.boolean().optional(),
        locked: z.boolean().optional()
    })
};
const REQUIRED = {
    exam_question: ["prompt", "options", "correct"],
    quiz_question: ["prompt", "options", "correct"],
    self_check: ["question", "answer"],
    flashcard: ["front", "back"],
    scenario_criterion: ["label"],
    lesson: [],
    module: []
};
const CURRENT = {
    exam_question: "options, correct_index",
    quiz_question: "options, correct_index"
};
const RENAME = { published: "is_published", locked: "is_locked", correct: "correct_index", lesson: "session_id" };
function splitId(line) {
    const [first, ...rest] = line.split("|");
    const head = (first ?? "").trim();
    return isAlias(head) || isUuid(head) ? { ref: head, rest: rest.join("|") } : { ref: undefined, rest: line };
}
const unescapeText = (value) => typeof value === "string" ? value.replace(/\\n/g, "\n") : Array.isArray(value) ? value.map(unescapeText) : value;
const unescapeFields = (patch) => Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, unescapeText(value)]));
function lineEntries(kind, input, issues) {
    const entries = [];
    input.split(/\r?\n/).forEach((row, index) => {
        const line = index + 1;
        const trimmed = row.trim();
        if (!trimmed || trimmed.startsWith("#"))
            return;
        const { ref, rest } = splitId(trimmed);
        if (kind === "exam_question" || kind === "quiz_question") {
            const parsed = parseQuestionLines(rest, 1);
            const question = parsed.questions[0];
            if (!question) {
                issues.push({ line, message: parsed.issues[0]?.message ?? "Línea no válida." });
                return;
            }
            const raw = { prompt: question.prompt, options: question.options, correct: question.correct };
            if (question.explanation !== undefined)
                raw.explanation = question.explanation;
            if (kind === "exam_question" && question.topic !== undefined)
                raw.topic = question.topic;
            if (kind === "exam_question" && question.lesson_number !== undefined)
                raw.lesson = question.lesson_number;
            entries.push({ line, ref, raw: unescapeFields(raw) });
            return;
        }
        if (kind === "flashcard" || kind === "self_check") {
            const [front, ...back] = rest.split("|");
            const second = back.join("|").trim();
            if (!front?.trim() || !second) {
                issues.push({ line, message: "Cada línea necesita dos partes separadas por «|»." });
                return;
            }
            entries.push({
                line,
                ref,
                raw: unescapeFields(kind === "flashcard" ? { front: front.trim(), back: second } : { question: front.trim(), answer: second })
            });
            return;
        }
        issues.push({ line, message: "Este tipo no admite líneas: usa `items`." });
    });
    return entries;
}
function resolveRef(ref) {
    if (ref === undefined)
        return { id: undefined };
    const resolved = aliases.resolve(ref);
    return resolved && isUuid(resolved) ? { id: resolved } : { error: "ID desconocido en esta sesión; vuelve a listar." };
}
export function collectEdits(kind, input) {
    const issues = [];
    const lineIssues = [];
    const raw = [];
    if (input.lines)
        for (const entry of lineEntries(kind, input.lines, lineIssues))
            raw.push({ label: `línea ${entry.line}`, ...entry });
    for (const issue of lineIssues)
        issues.push({ label: `línea ${issue.line}`, message: issue.message });
    (input.items ?? []).forEach((item, index) => {
        const { id: ref, ...rest } = item;
        raw.push({ label: `item ${index + 1}`, ref: typeof ref === "string" ? ref : undefined, raw: rest });
    });
    const entries = [];
    for (const item of raw) {
        const ref = resolveRef(item.ref);
        if ("error" in ref) {
            issues.push({ label: item.label, message: ref.error ?? "" });
            continue;
        }
        const parsed = PATCHES[kind].strict().safeParse(item.raw);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            issues.push({ label: item.label, message: `${issue?.path.join(".") ?? ""} ${issue?.message ?? "no válido"}`.trim() });
            continue;
        }
        const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined));
        if (!ref.id) {
            const missing = REQUIRED[kind].filter((field) => patch[field] === undefined);
            if (REQUIRED[kind].length === 0)
                issues.push({ label: item.label, message: "Este tipo solo se edita: falta `id`." });
            else if (missing.length > 0)
                issues.push({ label: item.label, message: `Para crear faltan: ${missing.join(", ")}.` });
        }
        else if (Object.keys(patch).length === 0)
            issues.push({ label: item.label, message: "No hay nada que cambiar." });
        entries.push({ label: item.label, id: ref.id, patch });
    }
    if (issues.length > 0)
        throw new ToolError(`Hay errores (no se guardó nada):\n${issues
            .slice(0, LIMITS.issuesShown)
            .map((issue) => `${issue.label}: ${issue.message}`)
            .join("\n")}${issues.length > LIMITS.issuesShown ? `\n… y ${issues.length - LIMITS.issuesShown} más.` : ""}`, "Corrige y vuelve a enviar todo.");
    if (entries.length === 0)
        throw new ToolError("No hay nada que guardar.", "Envía `lines` o `items`.");
    if (entries.length > LIMITS.bulkQuestions)
        throw new ToolError(`Máximo ${LIMITS.bulkQuestions} elementos por llamada.`);
    return entries;
}
function checkAnswer(entry, current) {
    if (entry.patch.options === undefined && entry.patch.correct === undefined)
        return;
    const options = entry.patch.options ?? current?.options ?? [];
    const answer = entry.patch.correct ?? (current?.correct_index ?? 0) + 1;
    if (answer > options.length)
        throw new ToolError(`${entry.label}: la opción correcta (${answer}) está fuera de rango (${options.length} opciones).`);
    entry.patch.options = options;
    entry.patch.correct = answer;
}
async function lessonNumbers(db, moduleIds) {
    if (moduleIds.length === 0)
        return new Map();
    const { data } = await db
        .from("sessions")
        .select("id, module_id, number")
        .in("module_id", [...new Set(moduleIds)]);
    return new Map((data ?? []).map((row) => [`${row.module_id}:${row.number}`, row.id]));
}
function toRow(entry, lessons, moduleId) {
    const row = {};
    for (const [key, value] of Object.entries(entry.patch)) {
        if (key === "correct")
            row.correct_index = value - 1;
        else if (key === "lesson") {
            if (value === 0)
                row.session_id = null;
            else {
                const session = lessons.get(`${moduleId}:${value}`);
                if (!session)
                    throw new ToolError(`${entry.label}: el módulo no tiene la lección ${value}.`);
                row.session_id = session;
            }
        }
        else
            row[RENAME[key] ?? key] = value;
    }
    return row;
}
async function createParent(db, actor, classroomId, kind, parentId) {
    if (kind === "exam_question")
        return { column: "exam_id", ...(await ownedParent(db, actor, classroomId, "exams", parentId)) };
    if (kind === "scenario_criterion")
        return { column: "scenario_id", ...(await ownedParent(db, actor, classroomId, "scenarios", parentId)) };
    const session = await ownedSession(db, actor, classroomId, parentId);
    return { column: "session_id", moduleId: session.moduleId, courseId: session.courseId };
}
const TABLE = {
    exam_question: "exam_questions",
    quiz_question: "quiz_questions",
    self_check: "session_questions",
    flashcard: "flashcards",
    scenario_criterion: "scenario_criteria",
    lesson: "sessions",
    module: "modules"
};
export const editItems = defineTool({
    name: "edit_items",
    title: "Editar o crear elementos en bloque",
    description: `Edita (y crea) hasta ${LIMITS.bulkQuestions} elementos en una llamada. kind: exam_question, quiz_question, self_check, flashcard, scenario_criterion, lesson o module.
- lines (preguntas, tarjetas, autoevaluación): una por línea, con el ID delante para editar: «@id | enunciado | op | *correcta | explicación: … | tema: … | lección: 2», «@id | anverso | reverso», «@id | pregunta | respuesta». Sin ID se crea en parent_id. Lo que no aparezca en la línea no cambia.
- items: [{id, …solo los campos a cambiar}]. Campos: preguntas prompt, options, correct (desde 1), explanation, topic, lesson (número; 0 la quita), difficulty; self_check question, answer; flashcard front, back, published; scenario_criterion label, if_met, if_missed, topic, weight; lesson title, summary, key_idea, format, content, published; module title, objective, published, locked. "" borra un texto opcional.
Todo se valida antes de guardar; dry_run=true solo valida. Confirma antes de publicar.`,
    level: "team",
    readOnly: false,
    input: z
        .object({
        classroom_id: id("Aula"),
        kind: z.enum(EDITABLE),
        parent_id: id("Examen, lección o escenario donde crear (solo para elementos nuevos)").optional(),
        lines: z.string().max(400_000).optional(),
        items: z.array(z.record(z.string(), z.unknown())).max(LIMITS.bulkQuestions).optional(),
        dry_run: z.boolean().default(false)
    })
        .refine((input) => Boolean(input.lines?.trim()) || (input.items?.length ?? 0) > 0, { error: "Envía `lines` o `items`." }),
    async run({ db, actor }, input) {
        const kind = input.kind;
        const entries = collectEdits(kind, input);
        const updates = entries.filter((entry) => entry.id);
        const creates = entries.filter((entry) => !entry.id);
        if (creates.length > 0 && !input.parent_id)
            throw new ToolError(`Hay ${creates.length} elemento(s) sin ID: indica parent_id para crearlos o añade el ID para editarlos.`);
        const [current, parent] = await Promise.all([
            updates.length > 0
                ? ownedRows(db, actor, input.classroom_id, kind, updates.map((entry) => entry.id), CURRENT[kind] ?? "")
                : new Map(),
            creates.length > 0 && input.parent_id ? createParent(db, actor, input.classroom_id, kind, input.parent_id) : null
        ]);
        for (const entry of entries)
            checkAnswer(entry, entry.id ? current.get(entry.id) : undefined);
        const needsLessons = kind === "exam_question" && entries.some((entry) => entry.patch.lesson);
        const lessons = needsLessons
            ? await lessonNumbers(db, [
                ...[...current.values()].map((row) => row.moduleId),
                ...(parent?.moduleId ? [parent.moduleId] : [])
            ])
            : new Map();
        const updateRows = updates.map((entry) => ({
            id: entry.id,
            row: toRow(entry, lessons, current.get(entry.id)?.moduleId)
        }));
        const createRows = creates.map((entry) => toRow(entry, lessons, parent?.moduleId));
        if (input.dry_run)
            return {
                dry_run: true,
                valid: true,
                would_update: updateRows.length,
                would_create: createRows.length,
                fields: [...new Set(updateRows.flatMap((item) => Object.keys(item.row)))]
            };
        const table = TABLE[kind];
        const failed = [];
        await inBatches(updateRows, 10, async (item) => {
            const { error } = await db.from(table).update(item.row).eq("id", item.id);
            if (error)
                failed.push(item.id);
        });
        let created = [];
        if (createRows.length > 0 && parent && input.parent_id) {
            if (kind === "exam_question") {
                const { count } = await db.from("exam_questions").select("id", { count: "exact", head: true }).eq("exam_id", input.parent_id);
                if ((count ?? 0) + createRows.length > LIMITS.examQuestions)
                    throw new ToolError(`Un examen admite hasta ${LIMITS.examQuestions} preguntas (tiene ${count ?? 0}).`);
            }
            const start = await nextPosition(db, table, parent.column, input.parent_id);
            const rows = createRows.map((row, index) => ({
                ...row,
                [parent.column]: input.parent_id,
                ...(kind === "flashcard" ? { course_id: parent.courseId, is_published: row.is_published ?? true } : {}),
                ...(kind === "quiz_question" ? { difficulty: row.difficulty ?? 3 } : {}),
                ...(kind === "scenario_criterion" ? { weight: row.weight ?? 1 } : {}),
                position: start + index
            }));
            const { data, error } = await db.from(table).insert(rows).select("id");
            if (error || !data)
                throw new ToolError("No pudimos crear los elementos nuevos.", updateRows.length ? "Los cambios a los existentes sí se guardaron." : undefined);
            created = data.map((row) => row.id);
        }
        if (failed.length > 0)
            throw new ToolError(`Se guardaron ${updateRows.length - failed.length} de ${updateRows.length} cambios.`, `Fallaron: ${failed.map((item) => aliases.alias(item)).join(", ")}. Reintenta solo esos.`);
        return { updated: updateRows.length, created: created.length, ...(created.length ? { new_ids: created } : {}) };
    }
});
const confirm = z.literal(true).describe("true solo tras confirmarlo la persona");
export const deleteItems = defineTool({
    name: "delete_items",
    title: "Borrar elementos en bloque",
    description: `Borra hasta ${LIMITS.bulkQuestions} elementos del mismo tipo en una llamada. kind: exam_question, quiz_question, self_check, flashcard, scenario_criterion, game, lesson (con su quiz, tarjetas y juegos), module (con sus lecciones y evaluaciones) o theme. Irreversible: muestra qué se borra y pide confirmación.`,
    level: "team",
    readOnly: false,
    destructive: true,
    input: z.object({
        classroom_id: id("Aula"),
        kind: z.enum(ITEM_KINDS),
        ids: z.array(id("Elemento")).min(1).max(LIMITS.bulkQuestions),
        confirm
    }),
    async run({ db, actor }, input) {
        const rows = await ownedRows(db, actor, input.classroom_id, input.kind, input.ids);
        const ids = [...rows.keys()];
        const { error } = await db.from(KINDS[input.kind].table).delete().in("id", ids);
        if (error)
            throw new ToolError("No pudimos borrar los elementos.");
        return { deleted: ids.length, kind: input.kind };
    }
});

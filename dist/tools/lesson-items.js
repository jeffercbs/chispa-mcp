import { z } from "zod";
import { describeIssues, parseCardLines, parseQuestionLines } from "../domain/bulk.js";
import { ToolError } from "../domain/errors.js";
import { id, optionalText, text } from "../domain/sanitize.js";
import { LIMITS } from "../limits.js";
import { defineTool } from "../mcp/tool.js";
import { nextPosition, ownedSession } from "./ownership.js";
import { insertChunks } from "./shared.js";
const option = text(300, "Opción");
export const quizQuestion = z
    .object({
    prompt: text(1000, "Pregunta"),
    options: z.array(option).min(2).max(6).describe("De 2 a 6 opciones"),
    correct: z.number().int().min(1).max(6).describe("Número de la opción correcta, desde 1"),
    explanation: optionalText(1000, "Por qué esa es la correcta"),
    difficulty: z.number().int().min(1).max(5).default(3).describe("1 fácil, 5 difícil")
})
    .refine((item) => item.correct <= item.options.length, { error: "La opción correcta está fuera de rango." });
export const addQuizQuestions = defineTool({
    name: "add_quiz_questions",
    title: "Cargar preguntas de quiz",
    description: `Carga preguntas de opción múltiple en el quiz de una lección (hasta ${LIMITS.bulkQuestions} por llamada). Envía \`questions\` (JSON) o \`questions_text\` (una por línea: «enunciado | opción | *correcta | opción | explicación: …»). Todo o nada; dry_run=true valida sin guardar.`,
    level: "team",
    readOnly: false,
    input: z
        .object({
        classroom_id: id("Aula"),
        session_id: id("Lección"),
        questions: z.array(quizQuestion).max(LIMITS.bulkQuestions).optional(),
        questions_text: z.string().max(400_000).optional().describe("Texto compacto, una pregunta por línea"),
        dry_run: z.boolean().default(false)
    })
        .refine((input) => (input.questions?.length ?? 0) > 0 || Boolean(input.questions_text?.trim()), {
        error: "Envía `questions` o `questions_text`."
    }),
    async run({ db, actor }, input) {
        await ownedSession(db, actor, input.classroom_id, input.session_id);
        const items = [...(input.questions ?? [])];
        if (input.questions_text) {
            const { questions, issues, lines } = parseQuestionLines(input.questions_text, LIMITS.bulkQuestions);
            const invalid = [...issues];
            questions.forEach((raw, index) => {
                const parsed = quizQuestion.safeParse({ ...raw, difficulty: 3 });
                if (parsed.success)
                    items.push(parsed.data);
                else
                    invalid.push({ line: lines[index] ?? index + 1, message: parsed.error.issues[0]?.message ?? "Pregunta no válida." });
            });
            if (invalid.length > 0)
                throw new ToolError(`Hay errores en las preguntas (no se guardó nada):\n${describeIssues(invalid.sort((a, b) => a.line - b.line), LIMITS.issuesShown)}`, "Corrige esas líneas y vuelve a enviar toda la carga.");
        }
        if (items.length > LIMITS.bulkQuestions)
            throw new ToolError(`Máximo ${LIMITS.bulkQuestions} preguntas por llamada.`);
        if (input.dry_run)
            return { dry_run: true, valid: true, would_add: items.length, preview: items.slice(0, 3).map((item) => item.prompt) };
        const start = await nextPosition(db, "quiz_questions", "session_id", input.session_id);
        await insertChunks(db, "quiz_questions", items.map((item, index) => ({
            session_id: input.session_id,
            prompt: item.prompt,
            options: item.options,
            correct_index: item.correct - 1,
            explanation: item.explanation,
            difficulty: item.difficulty,
            position: start + index
        })), "No pudimos guardar las preguntas.");
        return { added: items.length };
    }
});
export const addFlashcards = defineTool({
    name: "add_flashcards",
    title: "Cargar tarjetas de repaso",
    description: `Carga tarjetas de repaso en una lección (hasta ${LIMITS.bulkFlashcards} por llamada). Envía \`cards\` (JSON) o \`cards_text\` (una por línea: «anverso | reverso»). Todo o nada; dry_run=true valida sin guardar. Quedan visibles en la lección y en el mazo del curso.`,
    level: "team",
    readOnly: false,
    input: z
        .object({
        classroom_id: id("Aula"),
        session_id: id("Lección"),
        cards: z
            .array(z.object({ front: text(600, "Cara delantera"), back: text(2000, "Cara trasera") }))
            .max(LIMITS.bulkFlashcards)
            .optional(),
        cards_text: z.string().max(200_000).optional().describe("Texto compacto, una tarjeta por línea"),
        dry_run: z.boolean().default(false)
    })
        .refine((input) => (input.cards?.length ?? 0) > 0 || Boolean(input.cards_text?.trim()), { error: "Envía `cards` o `cards_text`." }),
    async run({ db, actor }, input) {
        const { courseId } = await ownedSession(db, actor, input.classroom_id, input.session_id);
        const cards = [...(input.cards ?? [])];
        if (input.cards_text) {
            const parsed = parseCardLines(input.cards_text, LIMITS.bulkFlashcards);
            if (parsed.issues.length > 0)
                throw new ToolError(`Hay errores en las tarjetas (no se guardó nada):\n${describeIssues(parsed.issues, LIMITS.issuesShown)}`, "Corrige esas líneas y vuelve a enviar toda la carga.");
            for (const card of parsed.cards) {
                const checked = z.object({ front: text(600, "Cara delantera"), back: text(2000, "Cara trasera") }).safeParse(card);
                if (!checked.success)
                    throw new ToolError(`Tarjeta «${card.front.slice(0, 40)}»: ${checked.error.issues[0]?.message}`);
                cards.push(checked.data);
            }
        }
        if (cards.length > LIMITS.bulkFlashcards)
            throw new ToolError(`Máximo ${LIMITS.bulkFlashcards} tarjetas por llamada.`);
        if (input.dry_run)
            return { dry_run: true, valid: true, would_add: cards.length, preview: cards.slice(0, 3).map((card) => card.front) };
        const start = await nextPosition(db, "flashcards", "session_id", input.session_id);
        await insertChunks(db, "flashcards", cards.map((card, index) => ({
            course_id: courseId,
            session_id: input.session_id,
            front: card.front,
            back: card.back,
            is_published: true,
            position: start + index
        })), "No pudimos guardar las tarjetas.");
        return { added: cards.length };
    }
});

const LABELS = {
    explicacion: "explanation",
    explicación: "explanation",
    explanation: "explanation",
    tema: "topic",
    topic: "topic",
    leccion: "lesson",
    lección: "lesson",
    lesson: "lesson"
};
const LABELLED = /^\s*([\p{L}]+)\s*:\s*([\s\S]*)$/u;
export function parseQuestionLines(input, maxRows) {
    const questions = [];
    const issues = [];
    const lines = [];
    const rows = input.split(/\r?\n/);
    rows.forEach((row, index) => {
        const line = index + 1;
        const trimmed = row.trim();
        if (!trimmed || trimmed.startsWith("#"))
            return;
        if (questions.length + issues.length >= maxRows) {
            if (!issues.some((issue) => issue.message.startsWith("Hay más de")))
                issues.push({ line, message: `Hay más de ${maxRows} preguntas: divide la carga en varias llamadas.` });
            return;
        }
        const fields = trimmed.split("|").map((field) => field.trim());
        const prompt = fields.shift() ?? "";
        const options = [];
        let correct = 0;
        let marked = 0;
        let explanation;
        let topic;
        let lesson;
        let bad = null;
        for (const field of fields) {
            if (!field)
                continue;
            const label = LABELLED.exec(field);
            const kind = label ? LABELS[(label[1] ?? "").toLowerCase()] : undefined;
            if (label && kind) {
                const value = (label[2] ?? "").trim();
                if (kind === "explanation")
                    explanation = value;
                else if (kind === "topic")
                    topic = value;
                else {
                    const number = Number(value);
                    if (!Number.isInteger(number) || number < 1)
                        bad = "«lección:» debe ser un número entero desde 1.";
                    else
                        lesson = number;
                }
                continue;
            }
            if (field.startsWith("*")) {
                marked += 1;
                correct = options.length + 1;
                options.push(field.slice(1).trim());
            }
            else {
                options.push(field);
            }
        }
        if (!prompt)
            bad = "Falta el enunciado.";
        else if (options.length < 2)
            bad = "Hacen falta al menos dos opciones separadas por «|».";
        else if (options.length > 6)
            bad = "Hay más de 6 opciones.";
        else if (options.some((option) => !option))
            bad = "Hay una opción vacía.";
        else if (marked !== 1)
            bad = marked === 0 ? "Marca la opción correcta con «*» delante." : "Solo una opción puede llevar «*».";
        if (bad) {
            issues.push({ line, message: bad });
            return;
        }
        questions.push({
            prompt,
            options,
            correct,
            ...(explanation ? { explanation } : {}),
            ...(topic ? { topic } : {}),
            ...(lesson ? { lesson_number: lesson } : {})
        });
        lines.push(line);
    });
    return { questions, issues, lines };
}
/** Tarjetas: «anverso | reverso» por línea. */
export function parseCardLines(input, maxRows) {
    const cards = [];
    const issues = [];
    input.split(/\r?\n/).forEach((row, index) => {
        const trimmed = row.trim();
        if (!trimmed || trimmed.startsWith("#"))
            return;
        if (cards.length >= maxRows) {
            if (!issues.length || !issues[issues.length - 1]?.message.startsWith("Hay más de"))
                issues.push({ line: index + 1, message: `Hay más de ${maxRows} tarjetas: divide la carga en varias llamadas.` });
            return;
        }
        const [front, ...rest] = trimmed.split("|");
        const back = rest.join("|").trim();
        if (!front?.trim() || !back)
            issues.push({ line: index + 1, message: "Cada línea necesita «anverso | reverso»." });
        else
            cards.push({ front: front.trim(), back });
    });
    return { cards, issues };
}
export const describeIssues = (issues, shown) => issues
    .slice(0, shown)
    .map((issue) => `línea ${issue.line}: ${issue.message}`)
    .join("\n") + (issues.length > shown ? `\n… y ${issues.length - shown} más.` : "");

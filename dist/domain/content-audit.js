const words = (value) => value.trim().split(/\s+/).filter(Boolean).length;
const normalize = (value) => value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const CITES_NORM = /\b(art(\.|[ií]culo)|ley|decreto|resoluci[oó]n|acuerdo|constituci[oó]n|c[oó]digo|sentencia|circular|norma)\b/i;
const BANNED = /\b(ninguna de las anteriores|todas las anteriores|ninguna es correcta|todas son correctas)\b/i;
const ABSOLUTE = /\b(siempre|nunca|jam[aá]s|todos|ninguno|únicamente|exclusivamente)\b/i;
const pct = (part, total) => (total ? Math.round((part / total) * 100) : 0);
function shingles(value) {
    const tokens = normalize(value).split(" ");
    const out = new Set();
    for (let index = 0; index + 2 < tokens.length; index++)
        out.add(tokens.slice(index, index + 3).join(" "));
    return out;
}
function similarity(a, b) {
    if (a.size === 0 || b.size === 0)
        return 0;
    let shared = 0;
    for (const item of a)
        if (b.has(item))
            shared++;
    return shared / (a.size + b.size - shared);
}
function repeatedFiller(questions) {
    const seen = new Map();
    for (const question of questions) {
        const local = new Set();
        question.options.forEach((option, index) => {
            if (index + 1 === question.correct)
                return;
            const tokens = normalize(option).split(" ");
            for (let start = 0; start + 5 <= tokens.length; start++)
                local.add(tokens.slice(start, start + 5).join(" "));
        });
        for (const phrase of local)
            seen.set(phrase, (seen.get(phrase) ?? 0) + 1);
    }
    return [...seen.entries()]
        .filter(([, total]) => total >= 3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([phrase, total]) => `«${phrase}» ×${total}`);
}
/** Reglas de `simulacros-examen-real`: formato, distractores, sesgos de longitud, posición y relleno. */
export function auditQuestions(questions, rules = { mode: "simulacro" }) {
    const total = questions.length;
    const issues = [];
    const flagged = new Map();
    const flag = (question, index, reason) => {
        const key = question.ref ?? `#${index + 1}`;
        flagged.set(key, [...(flagged.get(key) ?? []), reason]);
    };
    const strict = rules.mode !== "quiz";
    if (rules.mode === "simulacro" && (total < 30 || total > 40))
        issues.push(`Tiene ${total} preguntas; un simulacro de módulo lleva 30-40.`);
    const positions = new Map();
    const optionCounts = new Map();
    let longest = 0;
    let withoutNorm = 0;
    let shortCase = 0;
    let absolutesOnlyWrong = 0;
    const prints = questions.map((question) => shingles(question.prompt));
    questions.forEach((question, index) => {
        positions.set(question.correct, (positions.get(question.correct) ?? 0) + 1);
        optionCounts.set(question.options.length, (optionCounts.get(question.options.length) ?? 0) + 1);
        if (question.correct < 1 || question.correct > question.options.length)
            flag(question, index, "clave fuera de rango");
        const lengths = question.options.map(words);
        const right = lengths[question.correct - 1] ?? 0;
        if (lengths.every((length, position) => position === question.correct - 1 || length < right))
            longest++;
        if (strict && words(question.prompt) < 60) {
            shortCase++;
            flag(question, index, `caso corto (${words(question.prompt)} palabras)`);
        }
        if (!question.explanation?.trim())
            flag(question, index, "sin explicación");
        else if (strict && !CITES_NORM.test(question.explanation)) {
            withoutNorm++;
            flag(question, index, "la explicación no cita norma ni artículo");
        }
        if (question.options.some((option) => BANNED.test(option)))
            flag(question, index, "opción prohibida («ninguna/todas las anteriores»)");
        const normalized = question.options.map(normalize);
        if (new Set(normalized).size !== normalized.length)
            flag(question, index, "opciones repetidas");
        const wrongAbsolute = question.options.some((option, position) => position !== question.correct - 1 && ABSOLUTE.test(option));
        if (wrongAbsolute && !ABSOLUTE.test(question.options[question.correct - 1] ?? ""))
            absolutesOnlyWrong++;
        for (let other = 0; other < index; other++) {
            if (similarity(prints[index], prints[other]) >= 0.6) {
                flag(question, index, `casi igual a ${questions[other]?.ref ?? `#${other + 1}`}`);
                break;
            }
        }
    });
    const longestPct = pct(longest, total);
    if (total >= 10 && longestPct > 40)
        issues.push(`La correcta es la opción más larga en ${longestPct} % (meta 15-40 %): iguala longitudes con detalles propios de cada pregunta, sin cláusulas de plantilla.`);
    if (total >= 10 && longestPct < 15)
        issues.push(`La correcta casi nunca es la más larga (${longestPct} %, meta 15-40 %): sesgo inverso.`);
    for (const [position, count] of positions)
        if (total >= 10 && pct(count, total) > 40)
            issues.push(`La correcta está en la posición ${position} en ${pct(count, total)} % (máximo 40 %).`);
    if (optionCounts.size > 1)
        issues.push(`Mezcla número de opciones: ${[...optionCounts].map(([options, count]) => `${count} con ${options}`).join(", ")}. No mezclar dentro de un examen.`);
    if (shortCase > 0)
        issues.push(`${shortCase} pregunta(s) con caso de menos de 60 palabras (meta 70-100).`);
    if (withoutNorm > 0)
        issues.push(`${withoutNorm} explicación(es) sin norma ni artículo.`);
    if (absolutesOnlyWrong >= 3)
        issues.push(`En ${absolutesOnlyWrong} preguntas los absolutos («siempre», «nunca»…) solo aparecen en distractores: delata la respuesta.`);
    const filler = repeatedFiller(questions);
    if (filler.length > 0)
        issues.push(`Relleno repetido en distractores: ${filler.join(", ")}.`);
    return {
        questions: total,
        correct_longest: `${longestPct} %`,
        positions: Object.fromEntries([...positions].sort((a, b) => a[0] - b[0]).map(([position, count]) => [String(position), `${pct(count, total)} %`])),
        ok: issues.length === 0 && flagged.size === 0,
        issues,
        flagged: [...flagged].slice(0, 40).map(([ref, reasons]) => ({ ref, reasons: reasons.join("; ") })),
        ...(flagged.size > 40 ? { flagged_more: flagged.size - 40 } : {})
    };
}
const TRUNCATED = /(\.\.\.|…)\s*$|\bTODO\b|\[pendiente\]|\{\{|lorem ipsum/i;
/** Lista de `procesar-curso`: qué le falta a una lección para estar completa. */
export function auditLesson(lesson) {
    const gaps = [];
    const content = lesson.content ?? "";
    const objectives = Array.isArray(lesson.objectives) ? lesson.objectives.length : 0;
    if (!lesson.summary?.trim())
        gaps.push("resumen");
    if (lesson.format === "presentacion") {
        const slides = content.split(/\n-{3,}[ \t]*\n/).length;
        if (slides < 6 || slides > 15)
            gaps.push(`diapositivas ${slides} (6-15)`);
        if (!/^>/m.test(content))
            gaps.push("guion de voz");
    }
    else {
        if (objectives < 3)
            gaps.push(`objetivos ${objectives}/3`);
        if (!lesson.key_idea?.trim())
            gaps.push("idea clave");
        const total = words(content);
        if (total < 500)
            gaps.push(`contenido ${total}/500 palabras`);
        if (content && !/errores frecuentes/i.test(content))
            gaps.push("sin «Errores frecuentes»");
        if (content && !CITES_NORM.test(content))
            gaps.push("sin cita de norma");
        if (lesson.quiz < 8)
            gaps.push(`quiz ${lesson.quiz}/8`);
        if (lesson.flashcards < 4)
            gaps.push(`tarjetas ${lesson.flashcards}/4`);
        if (lesson.games < 1)
            gaps.push("sin juego");
    }
    if (TRUNCATED.test(content))
        gaps.push("contenido truncado o con marcadores");
    return gaps;
}

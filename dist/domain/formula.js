const FUNCTIONS = {
    sqrt: Math.sqrt,
    abs: Math.abs,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    ln: Math.log,
    log: Math.log10,
    min: Math.min,
    max: Math.max,
    pow: Math.pow
};
const CONSTANTS = { pi: Math.PI, e: Math.E };
export const MAX_EXPRESSION = 200;
function tokenize(source) {
    const tokens = [];
    const text = source.replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
    let i = 0;
    while (i < text.length) {
        const rest = text.slice(i);
        const number = rest.match(/^\d+(\.\d+)?/);
        if (number) {
            tokens.push({ type: "num", value: Number(number[0]) });
            i += number[0].length;
            continue;
        }
        const id = rest.match(/^[a-z][a-z0-9]*/i);
        if (id) {
            tokens.push({ type: "id", value: id[0] });
            i += id[0].length;
            continue;
        }
        const char = text[i] ?? "";
        if (char && "+-*/^(),%".includes(char)) {
            tokens.push({ type: "op", value: char });
            i += 1;
            continue;
        }
        throw new Error(`Carácter no permitido: «${char}».`);
    }
    return tokens;
}
export function evaluate(source, scope = {}) {
    if (source.length > MAX_EXPRESSION)
        throw new Error("La expresión es demasiado larga.");
    const tokens = tokenize(source);
    let position = 0;
    const peek = () => tokens[position];
    const take = () => tokens[position++];
    const isOp = (value) => peek()?.type === "op" && peek()?.value === value;
    function primary() {
        const token = take();
        if (!token)
            throw new Error("La expresión está incompleta.");
        if (token.type === "num")
            return token.value;
        if (token.type === "id") {
            const name = token.value.toLowerCase();
            if (isOp("(")) {
                take();
                const args = [];
                if (!isOp(")")) {
                    do {
                        if (isOp(","))
                            take();
                        args.push(additive());
                    } while (isOp(","));
                }
                if (!isOp(")"))
                    throw new Error("Falta cerrar un paréntesis.");
                take();
                const fn = FUNCTIONS[name];
                if (!fn)
                    throw new Error(`Función desconocida: ${token.value}.`);
                return fn(...args);
            }
            const bound = scope[token.value] ?? CONSTANTS[name];
            if (bound !== undefined)
                return bound;
            throw new Error(`Variable desconocida: ${token.value}.`);
        }
        if (token.value === "(") {
            const inner = additive();
            if (!isOp(")"))
                throw new Error("Falta cerrar un paréntesis.");
            take();
            return inner;
        }
        if (token.value === "-")
            return -unary();
        if (token.value === "+")
            return unary();
        throw new Error(`Símbolo inesperado: «${token.value}».`);
    }
    function postfix() {
        let value = primary();
        while (isOp("%")) {
            take();
            value /= 100;
        }
        return value;
    }
    function unary() {
        return power();
    }
    function power() {
        const base = postfix();
        if (isOp("^")) {
            take();
            return base ** (isOp("-") ? (take(), -power()) : power());
        }
        return base;
    }
    function multiplicative() {
        let value = power();
        while (isOp("*") || isOp("/")) {
            const op = take()?.value;
            const right = power();
            value = op === "*" ? value * right : value / right;
        }
        return value;
    }
    function additive() {
        let value = multiplicative();
        while (isOp("+") || isOp("-")) {
            const op = take()?.value;
            const right = multiplicative();
            value = op === "+" ? value + right : value - right;
        }
        return value;
    }
    const result = additive();
    if (position < tokens.length)
        throw new Error("Sobra texto al final de la expresión.");
    if (!Number.isFinite(result))
        throw new Error("El resultado no es un número.");
    return result;
}
export function parseVars(source) {
    const vars = {};
    for (const part of source.split(/[,;]/)) {
        const text = part.trim();
        if (!text)
            continue;
        const match = text.match(/^([a-z][a-z0-9]{0,3})\s*=\s*(-?\d+(?:\.\d+)?)\s*(?:\.\.|a|-)\s*(-?\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?$/i);
        if (!match || !match[1])
            return null;
        vars[match[1]] = { min: Number(match[2]), max: Number(match[3]), ...(match[4] ? { step: Number(match[4]) } : {}) };
    }
    return vars;
}
export function formatVars(vars) {
    return Object.entries(vars ?? {})
        .map(([name, range]) => `${name}=${range.min}..${range.max}${range.step ? `/${range.step}` : ""}`)
        .join(", ");
}
export const MAX_VARS = 8;
export function drawValue(range, random = Math.random) {
    const step = range.step && range.step > 0 ? range.step : 1;
    const count = Math.max(1, Math.floor((range.max - range.min) / step) + 1);
    const value = range.min + Math.floor(random() * count) * step;
    return Math.round(value * 1e6) / 1e6;
}
export function fill(template, scope) {
    return template.replace(/\{([a-z][a-z0-9]{0,3}|answer)\}/gi, (match, name) => (name in scope ? String(scope[name]).replace(".", ",") : match));
}
export function checkFormulaItem(item) {
    const vars = item.vars ?? {};
    if (Object.keys(vars).length > MAX_VARS)
        return `Máximo ${MAX_VARS} variables.`;
    for (const [name, range] of Object.entries(vars)) {
        if (!(range.min <= range.max))
            return `La variable ${name} tiene el mínimo mayor que el máximo.`;
        if (range.step !== undefined && !(range.step > 0))
            return `La variable ${name} necesita un paso mayor que 0.`;
    }
    const placeholders = [...item.text.matchAll(/\{([a-z][a-z0-9]{0,3})\}/gi)].map((m) => m[1] ?? "").filter((name) => name && name !== "answer");
    const unknown = placeholders.find((name) => !(name in vars));
    if (unknown)
        return `El texto usa {${unknown}} pero no está definida en las variables.`;
    for (let attempt = 0; attempt < 12; attempt++) {
        const scope = Object.fromEntries(Object.entries(vars).map(([name, range]) => [name, drawValue(range)]));
        try {
            evaluate(item.answer, scope);
            return null;
        }
        catch (error) {
            if (attempt === 11)
                return error instanceof Error ? error.message : "La respuesta no se puede calcular.";
        }
    }
    return null;
}
export const formatNumber = (value, decimals) => {
    const rounded = Number(value.toFixed(decimals));
    return String(rounded).replace(".", ",");
};
function distractors(value, decimals, random) {
    const unit = 10 ** -decimals;
    const spread = Math.max(Math.abs(value) * 0.25, unit * 3);
    const out = new Set();
    const factors = [-2, -1, 1, 2, 3, -3, 4];
    for (const factor of factors) {
        const candidate = Number((value + factor * spread * (0.4 + random() * 0.5)).toFixed(decimals));
        if (candidate !== Number(value.toFixed(decimals)))
            out.add(candidate);
        if (out.size >= 3)
            break;
    }
    let extra = 1;
    while (out.size < 3) {
        out.add(Number((value + extra * unit * 7).toFixed(decimals)));
        extra += 1;
    }
    return [...out].map((entry) => formatNumber(entry, decimals));
}
export function buildRound(item, random = Math.random) {
    const vars = item.vars ?? {};
    const decimals = item.decimals ?? 2;
    let scope = {};
    let value = Number.NaN;
    for (let attempt = 0; attempt < 30 && !Number.isFinite(value); attempt++) {
        scope = Object.fromEntries(Object.entries(vars).map(([name, range]) => [name, drawValue(range, random)]));
        try {
            value = evaluate(item.answer, scope);
        }
        catch {
            value = Number.NaN;
        }
    }
    if (!Number.isFinite(value))
        value = 0;
    const display = formatNumber(value, decimals);
    const mode = item.mode ?? "escribir";
    const text = fill(item.text, { ...scope, answer: display });
    const options = mode === "elegir"
        ? [display, ...distractors(value, decimals, random)].sort(() => random() - 0.5)
        : [];
    return {
        text,
        value,
        display,
        unit: item.unit,
        tolerance: item.tolerance ?? 10 ** -decimals / 2,
        options,
        mode,
        why: item.why ? fill(item.why, { ...scope, answer: display }) : undefined
    };
}
export function isCorrect(round, input) {
    const cleaned = input.trim().replace(/\s+/g, "").replace(",", ".").replace(/[^\d.\-+eE]/g, "");
    if (!cleaned)
        return false;
    const given = Number(cleaned);
    return Number.isFinite(given) && Math.abs(given - round.value) <= round.tolerance + 1e-9;
}

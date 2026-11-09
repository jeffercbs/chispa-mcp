import { describe, expect, it } from "vitest";
import { describeIssues, parseCardLines, parseQuestionLines } from "../src/domain/bulk.js";
import { collectQuestions } from "../src/tools/evaluations.js";

describe("carga masiva en texto compacto", () => {
	it("lee preguntas con opción correcta, explicación, tema y lección", () => {
		const { questions, issues } = parseQuestionLines(
			"¿Capital de Francia? | Madrid | *París | Roma | explicación: Sobre el Sena | tema: Geografía | lección: 2",
			200
		);
		expect(issues).toEqual([]);
		expect(questions).toEqual([
			{
				prompt: "¿Capital de Francia?",
				options: ["Madrid", "París", "Roma"],
				correct: 2,
				explanation: "Sobre el Sena",
				topic: "Geografía",
				lesson_number: 2
			}
		]);
	});

	it("ignora líneas vacías y comentarios, y numera los errores por línea real", () => {
		const text = [
			"# Mi simulacro",
			"",
			"Uno | *a | b",
			"Sin correcta | a | b",
			"Dos correctas | *a | *b",
			"Una sola opción | *a",
			"| a | *b"
		].join("\n");
		const { questions, issues } = parseQuestionLines(text, 200);
		expect(questions).toHaveLength(1);
		expect(issues.map((issue) => issue.line)).toEqual([4, 5, 6, 7]);
		expect(issues[0]?.message).toContain("Marca la opción correcta");
		expect(issues[1]?.message).toContain("Solo una opción");
		expect(issues[3]?.message).toContain("enunciado");
	});

	it("rechaza más de 6 opciones y números de lección inválidos", () => {
		const many = parseQuestionLines("P | *1 | 2 | 3 | 4 | 5 | 6 | 7", 10);
		expect(many.issues[0]?.message).toContain("más de 6");
		expect(parseQuestionLines("P | *a | b | lección: cero", 10).issues[0]?.message).toContain("lección");
	});

	it("respeta el máximo de filas", () => {
		const text = Array.from({ length: 5 }, (_, index) => `P${index} | *a | b`).join("\n");
		const { questions, issues } = parseQuestionLines(text, 3);
		expect(questions).toHaveLength(3);
		expect(issues[0]?.message).toContain("Hay más de 3");
	});

	it("lee tarjetas y avisa de las líneas incompletas", () => {
		const { cards, issues } = parseCardLines("ATP | Moneda de energía\nsolo anverso\n# nota", 10);
		expect(cards).toEqual([{ front: "ATP", back: "Moneda de energía" }]);
		expect(issues[0]?.line).toBe(2);
	});

	it("resume los errores sin desbordar", () => {
		const issues = Array.from({ length: 12 }, (_, index) => ({ line: index + 1, message: "mal" }));
		expect(describeIssues(issues, 3)).toContain("… y 9 más.");
	});
});

describe("collectQuestions", () => {
	it("valida todo antes de guardar y cita la línea que falla", () => {
		expect(() => collectQuestions({ questions_text: "Bien | *a | b\nMal | a | b" })).toThrow(/línea 2/);
	});

	it("une JSON y texto, y exige al menos una pregunta", () => {
		const out = collectQuestions({
			questions: [{ prompt: "J", options: ["a", "b"], correct: 1, explanation: null, topic: null, lesson_number: undefined }],
			questions_text: "T | *a | b"
		});
		expect(out.map((item) => item.prompt)).toEqual(["J", "T"]);
		expect(() => collectQuestions({})).toThrow("No hay preguntas");
	});
});

import { describe, expect, it } from "vitest";
import { auditLesson, auditQuestions } from "../src/domain/content-audit.js";

const longCase = (seed: number) =>
	`Caso ${seed}: ${Array.from({ length: 75 }, (_, index) => `palabra${(seed * 31 + index) % 997}`).join(" ")}. Tomando en consideración la normatividad vigente, el funcionario debe:`;

const good = (seed: number, correct: number) => ({
	ref: `@${seed}`,
	prompt: longCase(seed),
	options: [
		`Responder en ${seed + 15} días hábiles`,
		`Trasladar a la oficina ${seed} sin respuesta`,
		`Archivar el expediente número ${seed * 3}`
	],
	correct,
	explanation: "Ley 1755 de 2015, art. 14: el plazo general es de quince días."
});

describe("auditoría de simulacros", () => {
	it("aprueba un simulacro equilibrado", () => {
		const questions = Array.from({ length: 30 }, (_, index) => good(index, (index % 3) + 1));
		const report = auditQuestions(questions);
		expect(report.issues.filter((issue) => !issue.includes("más larga"))).toEqual([]);
		expect(report.flagged).toEqual([]);
	});

	it("detecta sesgo de posición, opciones prohibidas, explicaciones sin norma y casos cortos", () => {
		const questions = Array.from({ length: 12 }, (_, index) => ({
			ref: `@q${index}`,
			prompt: `¿Pregunta corta número ${index} sobre un tema distinto ${index * 7}?`,
			options: ["Una opción bastante más larga que las otras dos juntas", "Corta", "Ninguna de las anteriores"],
			correct: 1,
			explanation: "Porque sí."
		}));
		const report = auditQuestions(questions);
		expect(report.ok).toBe(false);
		expect(report.issues.join(" ")).toMatch(/30-40/);
		expect(report.issues.join(" ")).toMatch(/posición 1/);
		expect(report.issues.join(" ")).toMatch(/más larga/);
		expect(report.issues.join(" ")).toMatch(/sin norma/);
		expect(report.flagged[0]?.reasons).toMatch(/caso corto/);
		expect(report.flagged[0]?.reasons).toMatch(/prohibida/);
	});

	it("señala casi duplicados y mezcla de número de opciones", () => {
		const base = good(1, 2);
		const report = auditQuestions(
			[base, { ...base, ref: "@copia" }, { ...good(3, 1), options: ["a uno", "b dos", "c tres", "d cuatro"] }],
			{ mode: "lote" }
		);
		expect(report.flagged.some((item) => item.ref === "@copia" && item.reasons.includes("casi igual"))).toBe(true);
		expect(report.issues.join(" ")).toMatch(/Mezcla número de opciones/);
	});
});

describe("auditoría de lecciones", () => {
	it("lista lo que falta a una lectura", () => {
		const gaps = auditLesson({
			format: "lectura",
			title: "Derecho de petición",
			summary: "",
			objectives: ["Distinguir"],
			content: "Texto corto TODO",
			key_idea: null,
			is_published: true,
			quiz: 3,
			flashcards: 0,
			games: 0
		});
		expect(gaps).toEqual(
			expect.arrayContaining([
				"resumen",
				"objetivos 1/3",
				"idea clave",
				"quiz 3/8",
				"tarjetas 0/4",
				"sin juego",
				"contenido truncado o con marcadores"
			])
		);
	});

	it("revisa diapositivas y guion en presentaciones", () => {
		const gaps = auditLesson({
			format: "presentacion",
			title: "P",
			summary: "Resumen",
			objectives: [],
			content: "# Hola\n---\nUna",
			key_idea: null,
			is_published: false,
			quiz: 0,
			flashcards: 0,
			games: 0
		});
		expect(gaps).toEqual(["diapositivas 2 (6-15)", "guion de voz"]);
	});
});

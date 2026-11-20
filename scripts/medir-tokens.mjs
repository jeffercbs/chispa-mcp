#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const [oldCli, newCli] = process.argv.slice(2);
if (!oldCli || !newCli) {
	console.error("Uso: node scripts/medir-tokens.mjs <cli-anterior.js> <cli-nuevo.js>");
	process.exit(1);
}

const CHARS_PER_TOKEN = 3.5;
const tokens = (chars) => Math.round(chars / CHARS_PER_TOKEN);

function server(cli) {
	const child = spawn(process.execPath, [cli], { stdio: ["pipe", "pipe", "ignore"] });
	const pending = new Map();
	let next = 1;
	createInterface({ input: child.stdout }).on("line", (line) => {
		const message = JSON.parse(line);
		pending.get(message.id)?.(message);
		pending.delete(message.id);
	});
	const request = (method, params) =>
		new Promise((resolve) => {
			const id = next++;
			pending.set(id, resolve);
			child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
		});
	return {
		request,
		async call(name, args) {
			const response = await request("tools/call", { name, arguments: args });
			const result = response.result ?? {};
			const text = result.content?.[0]?.text ?? "";
			const copy = result.structuredContent ? JSON.stringify(result.structuredContent).length : 0;
			return { text, billed: text.length, copy, error: Boolean(result.isError), data: result.structuredContent };
		},
		close: () => child.kill()
	};
}

const rows = [];
const record = (label, before, after) => rows.push({ label, before, after });

const legacy = server(oldCli);
const modern = server(newCli);
await legacy.request("initialize", { protocolVersion: "2025-06-18" });
const init = await modern.request("initialize", { protocolVersion: "2025-06-18" });
const legacyInit = await (async () => {
	const fresh = server(oldCli);
	const response = await fresh.request("initialize", { protocolVersion: "2025-06-18" });
	fresh.close();
	return response;
})();
record("Instrucciones del servidor", legacyInit.result.instructions.length, init.result.instructions.length);

const legacyList = JSON.stringify((await legacy.request("tools/list")).result.tools);
const modernList = JSON.stringify((await modern.request("tools/list")).result.tools);
record("Lista de herramientas (tools/list)", legacyList.length, modernList.length);

const rooms = await legacy.call("list_my_classrooms", {});
if (rooms.error) {
	console.error(`Sin sesión o sin acceso: ${rooms.text}`);
	process.exit(1);
}
record("list_my_classrooms", rooms.billed, (await modern.call("list_my_classrooms", {})).billed);
const room = rooms.data.classrooms[0].classroom_id;

const courses = await legacy.call("list_courses", { classroom_id: room });
record("list_courses", courses.billed, (await modern.call("list_courses", { classroom_id: room })).billed);

let biggest = null;
for (const course of courses.data.courses.slice(0, 8)) {
	const outline = await legacy.call("get_course_outline", { classroom_id: room, course_id: course.course_id });
	const lessons = outline.data?.modules?.reduce((sum, mod) => sum + mod.lessons.length, 0) ?? 0;
	if (!biggest || lessons > biggest.lessons) biggest = { course: course.course_id, outline, lessons };
}
const outlineArgs = { classroom_id: room, course_id: biggest.course };
record(
	`get_course_outline (${biggest.lessons} lecciones)`,
	biggest.outline.billed,
	(await modern.call("get_course_outline", outlineArgs)).billed
);
record(
	"get_course_outline depth=modulos",
	biggest.outline.billed,
	(await modern.call("get_course_outline", { ...outlineArgs, depth: "modulos" })).billed
);

let exam = null;
let lesson = null;
for (const mod of biggest.outline.data.modules) {
	if (!lesson) {
		for (const item of mod.lessons) {
			const items = await legacy.call("list_lesson_items", { classroom_id: room, session_id: item.session_id });
			if (items.data?.quiz_questions?.length >= 3) {
				lesson = { id: item.session_id, items };
				break;
			}
		}
	}
	if (!exam) {
		const detail = await legacy.call("get_module", { classroom_id: room, module_id: mod.module_id });
		const first = detail.data?.exams?.[0];
		if (first) exam = { id: first.exam_id, module: mod.module_id };
	}
	if (exam && lesson) break;
}

if (exam) {
	const examArgs = { classroom_id: room, exam_id: exam.id };
	const full = await legacy.call("get_exam", examArgs);
	const count = full.data.questions.length;
	record(`get_exam: copia duplicada en structuredContent (${count} preguntas)`, full.copy, 0);
	record(`get_exam (${count} preguntas) → view=resumen`, full.billed, (await modern.call("get_exam", examArgs)).billed);
	record(
		"get_exam → view=preguntas (enunciado, opciones, correcta)",
		full.billed,
		(await modern.call("get_exam", { ...examArgs, view: "preguntas", limit: 200 })).billed
	);
	const lines = await modern.call("get_exam", {
		...examArgs,
		view: "lineas",
		limit: 200,
		fields: ["prompt", "options", "correct", "explanation", "topic", "lesson"]
	});
	record("get_exam → view=lineas con explicación, tema y lección", full.billed, lines.billed);
	const search = await modern.call("search_content", {
		...outlineArgs,
		query: full.data.questions[0].prompt.split(/\s+/).slice(2, 5).join(" ")
	});
	record("Encontrar una pregunta: get_exam completo vs search_content", full.billed, search.billed);

	const ten = full.data.questions.slice(0, 10);
	const oldArgs = ten
		.map((question) =>
			JSON.stringify({
				classroom_id: room,
				exam_id: exam.id,
				question_id: question.question_id,
				prompt: question.prompt,
				options: question.options,
				correct: question.correct,
				explanation: question.explanation ?? undefined,
				topic: question.topic ?? undefined
			})
		)
		.join("");
	const newArgs = JSON.stringify({ kind: "exam_question", lines: lines.text.split("\n").slice(1, 11).join("\n") });
	record("Corregir 10 preguntas: argumentos que escribe el modelo", oldArgs.length, newArgs.length);
	record("Corregir 10 preguntas: llamadas", 10, 1);
}

if (lesson) {
	const args = { classroom_id: room, session_id: lesson.id };
	record("list_lesson_items", lesson.items.billed, (await modern.call("list_lesson_items", args)).billed);
	const fullLesson = await legacy.call("get_lesson", args);
	record("get_lesson (sin contenido)", fullLesson.billed, (await modern.call("get_lesson", args)).billed);
	record("get_lesson (con contenido)", fullLesson.billed, (await modern.call("get_lesson", { ...args, fields: ["content"] })).billed);
}

const progress = await legacy.call("classroom_progress", { classroom_id: room });
if (!progress.error)
	record("classroom_progress", progress.billed, (await modern.call("classroom_progress", { classroom_id: room })).billed);

legacy.close();
modern.close();

const pct = (before, after) => (before ? `${Math.round((1 - after / before) * 100)} %` : "—");
console.log(
	`\nCaracteres que lee el modelo (tokens ≈ caracteres / ${CHARS_PER_TOKEN}). Solo se cuenta el texto de cada respuesta; la copia en structuredContent va aparte.\n`
);
console.log("| Medición | Antes | Después | Ahorro |");
console.log("| --- | ---: | ---: | ---: |");
for (const row of rows) {
	const unit = row.label.endsWith("llamadas");
	const show = (value) => (unit ? String(value) : `${value.toLocaleString("es-CO")} (~${tokens(value).toLocaleString("es-CO")} tk)`);
	console.log(`| ${row.label} | ${show(row.before)} | ${show(row.after)} | ${pct(row.before, row.after)} |`);
}

import { describe, expect, it } from "vitest";
import { type Actor, resolvePermissions } from "../src/domain/access.js";
import { creatorCourse, ownedCourse, ownedSession } from "../src/tools/ownership.js";

const USER = "11111111-1111-4111-8111-111111111111";
const ROOM = "22222222-2222-4222-8222-222222222222";
const COURSE = "33333333-3333-4333-8333-333333333333";
const MODULE = "44444444-4444-4444-8444-444444444444";
const SESSION = "55555555-5555-4555-8555-555555555555";

type Tables = Record<string, unknown>;

function fakeDb(tables: Tables) {
	return {
		rpc: async (_name: string, _args: unknown) => ({ data: tables.can_edit ?? false }),
		from(table: string) {
			const value = tables[table];
			const chain = {
				select: () => chain,
				eq: () => chain,
				in: () => chain,
				order: () => chain,
				limit: () => chain,
				maybeSingle: async () => ({ data: Array.isArray(value) ? (value[0] ?? null) : (value ?? null) }),
				// biome-ignore lint/suspicious/noThenProperty: el cliente de Supabase es «thenable» y la prueba lo imita
				then: (resolve: (result: { data: unknown }) => unknown) => resolve({ data: Array.isArray(value) ? value : value ? [value] : [] })
			};
			return chain;
		}
	} as never;
}

const actor = (systemAdmin = false): Actor => ({ userId: USER, classroomId: ROOM, role: "profesor", isOwner: false, permissions: resolvePermissions("profesor", null), systemAdmin });

describe("propiedad del contenido", () => {
	it("acepta un curso del aula que la persona puede editar", async () => {
		const db = fakeDb({ classroom_courses: [{ course_id: COURSE }], can_edit: true });
		await expect(ownedCourse(db, actor(), ROOM, COURSE)).resolves.toEqual({ courseId: COURSE });
	});

	it("rechaza un curso que no está en el aula", async () => {
		const db = fakeDb({ classroom_courses: [], can_edit: true });
		await expect(ownedCourse(db, actor(), ROOM, COURSE)).rejects.toThrow("No encontramos");
	});

	it("rechaza un curso que la persona no puede editar", async () => {
		const db = fakeDb({ classroom_courses: [{ course_id: COURSE }], can_edit: false });
		await expect(ownedCourse(db, actor(), ROOM, COURSE)).rejects.toThrow("No tienes permiso");
	});

	it("las acciones de creador exigen ser el dueño", async () => {
		const other = fakeDb({ classroom_courses: [{ course_id: COURSE }], courses: { owner_id: "otro" } });
		await expect(creatorCourse(other, actor(), ROOM, COURSE)).rejects.toThrow("Solo quien creó");
		const mine = fakeDb({ classroom_courses: [{ course_id: COURSE }], courses: { owner_id: USER } });
		await expect(creatorCourse(mine, actor(), ROOM, COURSE)).resolves.toEqual({ courseId: COURSE });
	});

	it("sube de la lección al módulo y al curso", async () => {
		const db = fakeDb({
			sessions: { module_id: MODULE, modules: { course_id: COURSE } },
			classroom_courses: [{ course_id: COURSE }],
			can_edit: true
		});
		await expect(ownedSession(db, actor(), ROOM, SESSION)).resolves.toEqual({ sessionId: SESSION, moduleId: MODULE, courseId: COURSE });
	});
});

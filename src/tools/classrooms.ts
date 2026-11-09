import { z } from "zod";
import { defineTool } from "../mcp/tool.js";

export const listMyClassrooms = defineTool({
	name: "list_my_classrooms",
	title: "Mis aulas",
	description: "Lista las aulas donde eres administrador o profesor, con tu rol en cada una. Úsala primero para obtener el classroom_id.",
	level: "none",
	readOnly: true,
	input: z.object({}),
	async run({ db, identity }) {
		const [{ data: owned }, { data: staff }] = await Promise.all([
			db.from("classrooms").select("id, name").eq("owner_id", identity.userId),
			db.from("classroom_staff").select("role, classrooms(id, name)").eq("user_id", identity.userId)
		]);
		const rooms = new Map<string, { classroom_id: string; name: string; role: string }>();
		for (const row of (owned ?? []) as { id: string; name: string }[])
			rooms.set(row.id, { classroom_id: row.id, name: row.name, role: "administrador" });
		for (const row of (staff ?? []) as {
			role: string;
			classrooms: { id: string; name: string } | { id: string; name: string }[] | null;
		}[]) {
			const room = Array.isArray(row.classrooms) ? row.classrooms[0] : row.classrooms;
			if (room && !rooms.has(room.id)) rooms.set(room.id, { classroom_id: room.id, name: room.name, role: row.role });
		}
		return { classrooms: [...rooms.values()] };
	}
});

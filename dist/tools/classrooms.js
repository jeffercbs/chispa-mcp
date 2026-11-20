import { z } from "zod";
import { defineTool } from "../mcp/tool.js";
export async function myClassrooms(db, userId) {
    const [{ data: owned }, { data: staff }] = await Promise.all([
        db.from("classrooms").select("id, name").eq("owner_id", userId),
        db.from("classroom_staff").select("role, classrooms(id, name)").eq("user_id", userId)
    ]);
    const rooms = new Map();
    for (const row of (owned ?? []))
        rooms.set(row.id, { classroom_id: row.id, name: row.name, role: "administrador" });
    for (const row of (staff ?? [])) {
        const room = Array.isArray(row.classrooms) ? row.classrooms[0] : row.classrooms;
        if (room && !rooms.has(room.id))
            rooms.set(room.id, { classroom_id: room.id, name: room.name, role: row.role });
    }
    return [...rooms.values()];
}
const remembered = new Map();
const DEFAULT_TTL_MS = 10 * 60_000;
export const forgetDefaultClassroom = () => remembered.clear();
/** Aula que se usa cuando la llamada no la indica: solo si la persona tiene exactamente una. */
export async function defaultClassroom(db, userId) {
    const hit = remembered.get(userId);
    if (hit && hit.expires > Date.now())
        return hit.id;
    const rooms = await myClassrooms(db, userId);
    const id = rooms.length === 1 ? (rooms[0]?.classroom_id ?? null) : null;
    remembered.set(userId, { id, expires: Date.now() + DEFAULT_TTL_MS });
    return id;
}
export const listMyClassrooms = defineTool({
    name: "list_my_classrooms",
    title: "Mis aulas",
    description: "Aulas donde eres administrador o profesor, con tu rol, y tu plan (profesor u organización) con su cupo de aulas. Si solo tienes una aula, las demás herramientas la usan sin pedir classroom_id.",
    level: "none",
    readOnly: true,
    input: z.object({}),
    async run({ db, identity }) {
        const [classrooms, { data: plan }] = await Promise.all([
            myClassrooms(db, identity.userId),
            db
                .from("chispa_subscriptions")
                .select("plan, period, classrooms_limit, students_limit, period_end")
                .eq("user_id", identity.userId)
                .maybeSingle()
        ]);
        const subscription = plan;
        return {
            classrooms,
            ...(subscription
                ? {
                    plan: {
                        name: subscription.plan,
                        period: subscription.period,
                        classrooms: `${classrooms.filter((room) => room.role === "administrador").length}/${subscription.classrooms_limit}`,
                        students_limit: subscription.students_limit,
                        until: subscription.period_end.slice(0, 10)
                    }
                }
                : {})
        };
    }
});

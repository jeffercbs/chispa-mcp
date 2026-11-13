import { z } from "zod";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { id, text } from "../domain/sanitize.js";
import { UNTRUSTED_NOTE } from "../limits.js";
import { defineTool } from "../mcp/tool.js";
import { profileNames } from "./shared.js";
export const listWaitingChats = defineTool({
    name: "list_waiting_chats",
    title: "Chats sin responder",
    description: "Lista las conversaciones del aula cuyo último mensaje es del estudiante, con ese mensaje.",
    level: "soporte",
    readOnly: true,
    input: z.object({ classroom_id: id("Aula") }),
    async run({ db }, input) {
        const { data } = await db
            .from("classroom_messages")
            .select("id, user_id, recipient_id, status, body, created_at")
            .eq("classroom_id", input.classroom_id)
            .eq("status", "abierto")
            .order("created_at", { ascending: false })
            .limit(100);
        const threads = (data ?? []);
        if (threads.length === 0)
            return { chats: [], note: UNTRUSTED_NOTE };
        const { data: notes } = await db
            .from("classroom_message_notes")
            .select("message_id, user_id, body, created_at")
            .in("message_id", threads.map((thread) => thread.id))
            .order("created_at");
        const last = new Map();
        for (const note of (notes ?? []))
            last.set(note.message_id, note);
        const waiting = threads
            .map((thread) => {
            const note = last.get(thread.id);
            return {
                thread,
                author: note?.user_id ?? thread.user_id,
                body: note?.body ?? thread.body,
                at: note?.created_at ?? thread.created_at
            };
        })
            .filter((item) => item.author === item.thread.user_id && item.body.trim());
        const names = await profileNames(db, waiting.map((item) => item.thread.user_id));
        return {
            note: UNTRUSTED_NOTE,
            chats: waiting.map((item) => ({
                thread_id: item.thread.id,
                student: names.get(item.thread.user_id) ?? "Sin nombre",
                last_message: item.body.slice(0, 1000),
                sent_at: item.at
            }))
        };
    }
});
export const replyChat = defineTool({
    name: "reply_chat",
    title: "Responder un chat",
    description: "Envía una respuesta en una conversación del aula. Muestra el texto a la persona y pide su confirmación antes de enviarlo.",
    level: "soporte",
    readOnly: false,
    input: z.object({ classroom_id: id("Aula"), thread_id: id("Conversación"), body: text(4000, "Mensaje") }),
    async run({ db, actor }, input) {
        const { data } = await db
            .from("classroom_messages")
            .select("id, classroom_id, status, recipient_id")
            .eq("id", input.thread_id)
            .maybeSingle();
        const thread = data;
        if (!thread || thread.classroom_id !== input.classroom_id)
            throw new ToolError(NOT_FOUND);
        if (thread.recipient_id !== actor.userId && actor.role !== "administrador")
            throw new ToolError("Esa conversación es con otra persona del equipo.");
        const { error } = await db.from("classroom_message_notes").insert({ message_id: thread.id, user_id: actor.userId, body: input.body });
        if (error)
            throw new ToolError("No pudimos enviar el mensaje.");
        if (thread.status === "resuelto")
            await db.from("classroom_messages").update({ status: "abierto" }).eq("id", thread.id);
        return { sent: true };
    }
});
async function threadInClassroom(db, classroomId, threadId) {
    const { data } = await db
        .from("classroom_messages")
        .select("id, classroom_id, user_id, recipient_id, status, body, created_at")
        .eq("id", threadId)
        .maybeSingle();
    const thread = data;
    if (!thread || thread.classroom_id !== classroomId)
        throw new ToolError(NOT_FOUND);
    return thread;
}
export const getChatThread = defineTool({
    name: "get_chat_thread",
    title: "Leer una conversación",
    description: "Devuelve los mensajes de una conversación del aula, en orden.",
    level: "soporte",
    readOnly: true,
    input: z.object({ classroom_id: id("Aula"), thread_id: id("Conversación") }),
    async run({ db }, input) {
        const thread = await threadInClassroom(db, input.classroom_id, input.thread_id);
        const { data } = await db
            .from("classroom_message_notes")
            .select("user_id, body, created_at")
            .eq("message_id", thread.id)
            .order("created_at");
        const notes = (data ?? []);
        const names = await profileNames(db, [thread.user_id, ...notes.map((note) => note.user_id)]);
        const say = (userId, body, at) => ({
            from: names.get(userId) ?? "Sin nombre",
            is_student: userId === thread.user_id,
            body: body.slice(0, 4000),
            sent_at: at
        });
        return {
            note: UNTRUSTED_NOTE,
            thread_id: thread.id,
            status: thread.status,
            messages: [say(thread.user_id, thread.body, thread.created_at), ...notes.map((note) => say(note.user_id, note.body, note.created_at))]
        };
    }
});
export const setChatStatus = defineTool({
    name: "set_chat_status",
    title: "Marcar una conversación",
    description: "Marca una conversación del aula como resuelta o la reabre.",
    level: "soporte",
    readOnly: false,
    input: z.object({ classroom_id: id("Aula"), thread_id: id("Conversación"), status: z.enum(["abierto", "resuelto"]) }),
    async run({ db }, input) {
        await threadInClassroom(db, input.classroom_id, input.thread_id);
        const { data, error } = await db
            .from("classroom_messages")
            .update({ status: input.status })
            .eq("id", input.thread_id)
            .select("id")
            .maybeSingle();
        if (error || !data)
            throw new ToolError("No pudimos cambiar el estado.");
        return { thread_id: input.thread_id, status: input.status };
    }
});
export const deleteChat = defineTool({
    name: "delete_chat",
    title: "Eliminar una conversación",
    description: "Elimina una conversación del aula con todos sus mensajes. Irreversible: pide confirmación explícita a la persona.",
    level: "soporte",
    readOnly: false,
    destructive: true,
    input: z.object({
        classroom_id: id("Aula"),
        thread_id: id("Conversación"),
        confirm: z.literal(true).describe("Debe ser true: la persona confirmó")
    }),
    async run({ db }, input) {
        await threadInClassroom(db, input.classroom_id, input.thread_id);
        const { error } = await db.from("classroom_messages").delete().eq("id", input.thread_id);
        if (error)
            throw new ToolError("No pudimos eliminar el chat.");
        return { deleted: true };
    }
});

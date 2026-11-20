import { z } from "zod";
import { ToolError } from "../domain/errors.js";
import { maskEmail, platformOf } from "../domain/platform.js";
import { id } from "../domain/sanitize.js";
import { userClient } from "../domain/supabase.js";
import { defineTool } from "../mcp/tool.js";
import { inBatches } from "./ownership.js";
const MAX_ROSTER = 80;
const MAX_SEND = 40;
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
export function parseRoster(raw) {
    const rows = [];
    const invalid = [];
    const seen = new Set();
    for (const line of raw.split(/\r?\n/)) {
        const clean = line.trim();
        if (!clean || clean.startsWith("#"))
            continue;
        const angled = clean.match(/^(.*?)<([^>]+)>$/);
        const parts = angled ? [angled[1] ?? "", angled[2] ?? ""] : clean.split(/[,;\t|]/);
        const index = parts.findIndex((part) => part.includes("@"));
        const email = (parts[index] ?? "").trim().toLowerCase();
        if (index === -1 || !EMAIL.test(email)) {
            invalid.push(clean.slice(0, 80));
            continue;
        }
        if (seen.has(email))
            continue;
        seen.add(email);
        const name = parts
            .filter((_, position) => position !== index)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        rows.push({ email, fullName: name ? name.slice(0, 120) : null });
    }
    return { rows, invalid };
}
async function sendMagicLinks(config, classroomId, people) {
    if (!config)
        return { sent: [], failed: people.map((row) => row.email) };
    const auth = userClient(config).auth;
    const platform = platformOf(classroomId);
    const emailRedirectTo = `${platform.site}/auth/callback?next=${encodeURIComponent(`/aula/${classroomId}`)}`;
    const sent = [];
    const failed = [];
    let halted = false;
    await inBatches(people.slice(0, MAX_SEND), 5, async (row) => {
        if (halted) {
            failed.push(row.email);
            return;
        }
        const { error } = await auth.signInWithOtp({
            email: row.email,
            options: { shouldCreateUser: true, emailRedirectTo, data: row.fullName ? { full_name: row.fullName } : undefined }
        });
        if (!error)
            sent.push(row.email);
        else {
            failed.push(row.email);
            if (/rate|too many|429/i.test(error.message))
                halted = true;
        }
    });
    failed.push(...people.slice(MAX_SEND).map((row) => row.email));
    return { sent, failed };
}
async function markSent(db, classroomId, emails) {
    if (emails.length === 0)
        return;
    await db.from("classroom_invites").update({ last_sent_at: new Date().toISOString() }).eq("classroom_id", classroomId).in("email", emails);
}
export const invitePeople = defineTool({
    name: "invite_people",
    title: "Invitar personas al aula",
    description: `Invita estudiantes al aula por correo: una persona por línea («correo», «Nombre, correo» o «Nombre <correo>»), hasta ${MAX_ROSTER} por llamada. Con send_mail=true (por defecto) les llega un enlace de acceso (máximo ${MAX_SEND} envíos por llamada). Repetidos y ya invitados no se duplican. dry_run=true solo valida. Confirma la lista con la persona antes de enviar.`,
    level: "team",
    readOnly: false,
    input: z.object({
        classroom_id: id("Aula"),
        people: z.string().min(3).max(20_000),
        send_mail: z.boolean().default(true),
        dry_run: z.boolean().default(false)
    }),
    async run({ db, actor, config }, input) {
        const { rows, invalid } = parseRoster(input.people);
        if (rows.length === 0)
            throw new ToolError("No encontré ningún correo válido.", invalid.length ? `Revisa: ${invalid.slice(0, 5).join(" · ")}` : undefined);
        if (rows.length > MAX_ROSTER)
            throw new ToolError(`Máximo ${MAX_ROSTER} personas por llamada.`, "Divide la lista en tandas.");
        const { data: existing } = await db.from("classroom_invites").select("email, claimed_at").eq("classroom_id", input.classroom_id);
        const already = new Map((existing ?? []).map((row) => [row.email.toLowerCase(), row.claimed_at]));
        const fresh = rows.filter((row) => !already.has(row.email));
        const toMail = rows.filter((row) => !already.get(row.email));
        if (input.dry_run)
            return {
                dry_run: true,
                new: fresh.length,
                repeated: rows.length - fresh.length,
                would_email: input.send_mail ? Math.min(toMail.length, MAX_SEND) : 0,
                invalid
            };
        if (fresh.length > 0) {
            const { error } = await db
                .from("classroom_invites")
                .insert(fresh.map((row) => ({ classroom_id: input.classroom_id, email: row.email, full_name: row.fullName, invited_by: actor.userId })));
            if (error)
                throw new ToolError("No pudimos guardar las invitaciones.", "Puede que tu plan no admita más estudiantes.");
        }
        const mailed = input.send_mail ? await sendMagicLinks(config, input.classroom_id, toMail) : { sent: [], failed: [] };
        await markSent(db, input.classroom_id, mailed.sent);
        return {
            added: fresh.length,
            repeated: rows.length - fresh.length,
            emailed: mailed.sent.length,
            ...(mailed.failed.length ? { not_emailed: mailed.failed.map(maskEmail), hint: "Reintenta en unos minutos con resend_invites." } : {}),
            ...(invalid.length ? { invalid } : {})
        };
    }
});
export const listInvites = defineTool({
    name: "list_invites",
    title: "Invitaciones del aula",
    description: "Invitaciones por correo con su estado (pendiente o aceptada) y último envío. Los correos se muestran ocultos en parte.",
    level: "team",
    readOnly: true,
    input: z.object({ classroom_id: id("Aula"), status: z.enum(["pendientes", "aceptadas", "todas"]).default("pendientes") }),
    async run({ db }, input) {
        let query = db
            .from("classroom_invites")
            .select("id, email, full_name, claimed_at, last_sent_at")
            .eq("classroom_id", input.classroom_id);
        if (input.status === "pendientes")
            query = query.is("claimed_at", null);
        if (input.status === "aceptadas")
            query = query.not("claimed_at", "is", null);
        const { data } = await query.order("created_at", { ascending: false }).limit(500);
        const rows = (data ?? []);
        return {
            total: rows.length,
            invites: rows.map((row) => ({
                id: row.id,
                email: maskEmail(row.email),
                name: row.full_name,
                accepted: Boolean(row.claimed_at),
                last_sent: row.last_sent_at?.slice(0, 10) ?? null
            }))
        };
    }
});
export const resendInvites = defineTool({
    name: "resend_invites",
    title: "Reenviar invitaciones",
    description: `Reenvía el enlace de acceso a invitaciones pendientes: las indicadas en ids o, sin ids, todas las pendientes (máximo ${MAX_SEND} por llamada). Confirma antes.`,
    level: "team",
    readOnly: false,
    input: z.object({ classroom_id: id("Aula"), ids: z.array(id("Invitación")).max(MAX_ROSTER).optional() }),
    async run({ db, config }, input) {
        let query = db.from("classroom_invites").select("email, full_name").eq("classroom_id", input.classroom_id).is("claimed_at", null);
        if (input.ids?.length)
            query = query.in("id", input.ids);
        const { data } = await query.order("last_sent_at", { ascending: true, nullsFirst: true }).limit(MAX_SEND);
        const people = (data ?? []).map((row) => ({
            email: row.email,
            fullName: row.full_name
        }));
        if (people.length === 0)
            return { emailed: 0, message: "No hay invitaciones pendientes." };
        const mailed = await sendMagicLinks(config, input.classroom_id, people);
        await markSent(db, input.classroom_id, mailed.sent);
        return { emailed: mailed.sent.length, ...(mailed.failed.length ? { not_emailed: mailed.failed.map(maskEmail) } : {}) };
    }
});

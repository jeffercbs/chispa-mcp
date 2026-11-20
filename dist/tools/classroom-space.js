import { z } from "zod";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { platformOf, requireManager } from "../domain/platform.js";
import { id, patchMarkdown, patchText, text } from "../domain/sanitize.js";
import { UNTRUSTED_NOTE } from "../limits.js";
import { defineTool } from "../mcp/tool.js";
import { profileNames } from "./shared.js";
const when = z.iso.datetime({ offset: true });
const day = z.iso.date();
const iso = (value) => (value === undefined ? undefined : value === null ? null : new Date(value).toISOString());
const confirm = z.literal(true).describe("true solo tras confirmarlo la persona");
const defined = (values) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
async function upsertRow(db, table, classroomId, rowId, patch, creating) {
    if (rowId) {
        if (Object.keys(patch).length === 0)
            throw new ToolError("No indicaste nada que cambiar.");
        const { data, error } = await db.from(table).update(patch).eq("id", rowId).eq("classroom_id", classroomId).select("id").maybeSingle();
        if (error || !data)
            throw new ToolError(error ? "No pudimos guardar los cambios." : NOT_FOUND);
        return { id: rowId, updated: Object.keys(patch) };
    }
    const { data, error } = await db
        .from(table)
        .insert({ ...creating, ...patch, classroom_id: classroomId })
        .select("id")
        .single();
    if (error || !data)
        throw new ToolError("No pudimos crearlo.", "Revisa que la herramienta esté activa en el aula (get_classroom).");
    return { id: data.id, created: true };
}
const LISTS = {
    tasks: { table: "classroom_tasks", columns: "id, title, due_at, is_published", order: "position" },
    meetings: {
        table: "classroom_meetings",
        columns: "id, title, starts_at, ends_at, is_published, session_id, meeting_url, recording_url",
        order: "starts_at"
    },
    resources: { table: "classroom_resources", columns: "id, title, kind, url", order: "position" },
    surveys: { table: "classroom_surveys", columns: "id, title, is_published, allows_suggestions, period_id", order: "created_at" },
    periods: { table: "classroom_periods", columns: "id, name, starts_on, ends_on", order: "position" },
    grade_items: { table: "classroom_extras", columns: "id, title, max_score, period_id", order: "position" },
    teams: { table: "classroom_teams", columns: "id, name, color, locked", order: "created_at" }
};
export const listClassroomItems = defineTool({
    name: "list_classroom_items",
    title: "Elementos del aula",
    description: "Lista un tipo de elemento del aula: tasks (actividades para entregar, con entregas), meetings (clases en vivo), resources, surveys (con opciones y votos), periods, grade_items (actividades calificables) o teams (equipos con miembros).",
    level: "team",
    readOnly: true,
    input: z.object({
        classroom_id: id("Aula"),
        kind: z.enum(Object.keys(LISTS)),
        limit: z.number().int().min(1).max(200).default(50)
    }),
    async run({ db }, input) {
        const spec = LISTS[input.kind];
        const { data } = await db
            .from(spec.table)
            .select(spec.columns)
            .eq("classroom_id", input.classroom_id)
            .order(spec.order, { ascending: input.kind !== "meetings" })
            .limit(input.limit);
        const rows = (data ?? []);
        const ids = rows.map((row) => row.id);
        const extra = new Map();
        if (ids.length > 0 && input.kind === "tasks") {
            const { data: subs } = await db.from("classroom_submissions").select("task_id").in("task_id", ids);
            for (const row of (subs ?? []))
                extra.set(row.task_id, (extra.get(row.task_id) ?? 0) + 1);
        }
        if (ids.length > 0 && input.kind === "surveys") {
            const { data: options } = await db
                .from("classroom_survey_options")
                .select("survey_id, label, vote_count")
                .in("survey_id", ids)
                .order("position");
            for (const row of (options ?? []))
                extra.set(row.survey_id, [...(extra.get(row.survey_id) ?? []), `${row.label} (${row.vote_count ?? 0})`]);
        }
        if (ids.length > 0 && input.kind === "teams") {
            const { data: members } = await db.from("classroom_team_members").select("team_id, user_id").in("team_id", ids);
            const list = (members ?? []);
            const names = await profileNames(db, [...new Set(list.map((row) => row.user_id))]);
            for (const row of list)
                extra.set(row.team_id, [...(extra.get(row.team_id) ?? []), names.get(row.user_id) ?? "Sin nombre"]);
        }
        const key = { tasks: "submissions", surveys: "options", teams: "members" };
        return {
            ...(platformOf(input.classroom_id).hidden.length ? { hidden_by_platform: platformOf(input.classroom_id).hidden } : {}),
            total: rows.length,
            [input.kind]: rows.map((row) => ({
                ...row,
                ...(key[input.kind] ? { [key[input.kind]]: extra.get(row.id) ?? (input.kind === "tasks" ? 0 : []) } : {})
            }))
        };
    }
});
export const listSubmissions = defineTool({
    name: "list_submissions",
    title: "Entregas de una actividad",
    description: "Respuestas que los estudiantes entregaron en una actividad del aula.",
    level: "team",
    readOnly: true,
    input: z.object({ classroom_id: id("Aula"), task_id: id("Actividad"), limit: z.number().int().min(1).max(200).default(50) }),
    async run({ db }, input) {
        const { data: task } = await db
            .from("classroom_tasks")
            .select("title")
            .eq("id", input.task_id)
            .eq("classroom_id", input.classroom_id)
            .maybeSingle();
        if (!task)
            throw new ToolError(NOT_FOUND);
        const { data } = await db
            .from("classroom_submissions")
            .select("user_id, response, submitted_at")
            .eq("task_id", input.task_id)
            .order("submitted_at", { ascending: false })
            .limit(input.limit);
        const rows = (data ?? []);
        const names = await profileNames(db, rows.map((row) => row.user_id));
        return {
            note: UNTRUSTED_NOTE,
            task: task.title,
            submissions: rows.map((row) => ({
                student: names.get(row.user_id) ?? "Sin nombre",
                at: row.submitted_at.slice(0, 16),
                response: (row.response ?? "").slice(0, 1500)
            }))
        };
    }
});
export const saveTask = defineTool({
    name: "save_task",
    title: "Crear o editar una actividad para entregar",
    description: "Actividad del aula que los estudiantes entregan (módulo Actividades). Sin task_id la crea (title obligatorio, borrador salvo published=true); con task_id cambia solo lo enviado. Confirma antes de publicar.",
    level: "team",
    readOnly: false,
    input: z.object({
        classroom_id: id("Aula"),
        task_id: id("Actividad").optional(),
        title: text(200, "Título").optional(),
        instructions: patchMarkdown(20_000, "Instrucciones"),
        due_at: when.nullable().optional().describe("Fecha límite ISO; null la quita"),
        published: z.boolean().optional()
    }),
    async run({ db }, input) {
        if (!input.task_id && !input.title)
            throw new ToolError("Una actividad nueva necesita title.");
        const patch = defined({
            title: input.title,
            instructions: input.instructions,
            due_at: iso(input.due_at),
            is_published: input.published
        });
        return upsertRow(db, "classroom_tasks", input.classroom_id, input.task_id, patch, { is_published: false, position: 1 });
    }
});
export const saveMeeting = defineTool({
    name: "save_meeting",
    title: "Programar o editar una clase en vivo",
    description: "Clase del aula con fecha, enlace de reunión y grabación, opcionalmente ligada a una lección (session_id). Sin meeting_id la crea (title y starts_at obligatorios); con meeting_id cambia solo lo enviado. Confirma antes de publicar.",
    level: "team",
    readOnly: false,
    input: z.object({
        classroom_id: id("Aula"),
        meeting_id: id("Clase").optional(),
        title: text(200, "Título").optional(),
        notes: patchMarkdown(20_000, "Notas"),
        starts_at: when.optional(),
        ends_at: when.nullable().optional(),
        meeting_url: z
            .url({ protocol: /^https$/ })
            .nullable()
            .optional(),
        recording_url: z
            .url({ protocol: /^https$/ })
            .nullable()
            .optional(),
        session_id: id("Lección").nullable().optional(),
        published: z.boolean().optional()
    }),
    async run({ db }, input) {
        if (!input.meeting_id && (!input.title || !input.starts_at))
            throw new ToolError("Una clase nueva necesita title y starts_at.");
        if (input.starts_at && input.ends_at && new Date(input.ends_at) <= new Date(input.starts_at))
            throw new ToolError("El final tiene que ser posterior al inicio.");
        const patch = defined({
            title: input.title,
            notes: input.notes,
            starts_at: iso(input.starts_at),
            ends_at: iso(input.ends_at),
            meeting_url: input.meeting_url,
            recording_url: input.recording_url,
            session_id: input.session_id,
            is_published: input.published
        });
        return upsertRow(db, "classroom_meetings", input.classroom_id, input.meeting_id, patch, { is_published: false });
    }
});
export const saveResource = defineTool({
    name: "save_resource",
    title: "Añadir o editar un recurso del aula",
    description: "Enlace en Recursos del aula (solo administrador). Sin resource_id lo crea (title y url obligatorios). Los archivos se suben desde la plataforma.",
    level: "manager",
    readOnly: false,
    input: z.object({
        classroom_id: id("Aula"),
        resource_id: id("Recurso").optional(),
        title: text(200, "Título").optional(),
        description: patchText(2000, "Descripción"),
        url: z.url({ protocol: /^https?$/ }).optional()
    }),
    async run({ db, actor }, input) {
        requireManager(actor, "gestionar los recursos");
        if (!input.resource_id && (!input.title || !input.url))
            throw new ToolError("Un recurso nuevo necesita title y url.");
        const patch = defined({ title: input.title, description: input.description, url: input.url });
        let position = 1;
        if (!input.resource_id) {
            const { data } = await db
                .from("classroom_resources")
                .select("position")
                .eq("classroom_id", input.classroom_id)
                .order("position", { ascending: false })
                .limit(1);
            position = ((data ?? [])[0]?.position ?? 0) + 1;
        }
        return upsertRow(db, "classroom_resources", input.classroom_id, input.resource_id, patch, { kind: "enlace", position });
    }
});
export const saveSurvey = defineTool({
    name: "save_survey",
    title: "Crear o editar una encuesta",
    description: "Encuesta del aula. options: una opción por línea (mínimo 2 si no se permiten sugerencias). Al editar, enviar options reemplaza las opciones (salvo que ya tenga votos o sugerencias: entonces solo añade las nuevas). Confirma antes de publicar.",
    level: "team",
    readOnly: false,
    input: z.object({
        classroom_id: id("Aula"),
        survey_id: id("Encuesta").optional(),
        title: text(160, "Título").optional(),
        prompt: text(2000, "Pregunta").optional(),
        options: z.string().max(5000).optional(),
        allows_suggestions: z.boolean().optional(),
        period_id: id("Periodo").nullable().optional(),
        published: z.boolean().optional()
    }),
    async run({ db }, input) {
        const labels = [
            ...new Set((input.options ?? "")
                .split(/\r?\n/)
                .map((line) => line
                .replace(/^[-*\d.)\s]+/, "")
                .trim()
                .slice(0, 200))
                .filter(Boolean))
        ];
        if (labels.length > 24)
            throw new ToolError("Máximo 24 opciones.");
        if (!input.survey_id && labels.length < 2 && !input.allows_suggestions)
            throw new ToolError("Pon al menos dos opciones, una por línea.");
        const patch = defined({
            title: input.title,
            prompt: input.prompt,
            allows_suggestions: input.allows_suggestions,
            period_id: input.period_id,
            is_published: input.published
        });
        const saved = await upsertRow(db, "classroom_surveys", input.classroom_id, input.survey_id, patch, {
            title: "Encuesta",
            prompt: "Elige una opción.",
            is_published: false,
            allows_suggestions: false
        });
        if (labels.length > 0) {
            const { data: existing } = await db
                .from("classroom_survey_options")
                .select("label, position, author_id, vote_count")
                .eq("survey_id", saved.id);
            const rows = (existing ?? []);
            const keep = rows.some((row) => row.author_id || (row.vote_count ?? 0) > 0);
            if (input.survey_id && !keep)
                await db.from("classroom_survey_options").delete().eq("survey_id", saved.id);
            const known = new Set(keep ? rows.map((row) => row.label.trim().toLowerCase()) : []);
            const start = keep ? rows.reduce((max, row) => Math.max(max, row.position), -1) + 1 : 0;
            const fresh = labels.filter((label) => !known.has(label.toLowerCase()));
            if (fresh.length > 0) {
                const { error } = await db
                    .from("classroom_survey_options")
                    .insert(fresh.map((label, index) => ({ survey_id: saved.id, label, position: start + index })));
                if (error)
                    throw new ToolError("Guardamos la encuesta, pero no las opciones.");
            }
            return { ...saved, options: (keep ? rows.length : 0) + fresh.length };
        }
        return saved;
    }
});
export const savePeriod = defineTool({
    name: "save_period",
    title: "Crear o editar un periodo",
    description: "Periodo académico del aula (para agrupar notas y encuestas). Fechas YYYY-MM-DD.",
    level: "team",
    readOnly: false,
    input: z.object({
        classroom_id: id("Aula"),
        period_id: id("Periodo").optional(),
        name: text(80, "Nombre").optional(),
        starts_on: day.nullable().optional(),
        ends_on: day.nullable().optional()
    }),
    async run({ db }, input) {
        if (!input.period_id && !input.name)
            throw new ToolError("Un periodo nuevo necesita name.");
        return upsertRow(db, "classroom_periods", input.classroom_id, input.period_id, defined({ name: input.name, starts_on: input.starts_on, ends_on: input.ends_on }), { position: 0 });
    }
});
export const saveGradeItem = defineTool({
    name: "save_grade_item",
    title: "Crear o editar una actividad calificable",
    description: "Columna de notas del aula (actividad extra calificable) con nota máxima y periodo opcional.",
    level: "team",
    readOnly: false,
    input: z.object({
        classroom_id: id("Aula"),
        item_id: id("Actividad calificable").optional(),
        title: text(160, "Título").optional(),
        details: patchText(4000, "Detalles"),
        max_score: z.number().positive().max(1000).optional(),
        period_id: id("Periodo").nullable().optional()
    }),
    async run({ db }, input) {
        if (!input.item_id && !input.title)
            throw new ToolError("Una actividad nueva necesita title.");
        return upsertRow(db, "classroom_extras", input.classroom_id, input.item_id, defined({ title: input.title, details: input.details, max_score: input.max_score, period_id: input.period_id }), { max_score: 5, position: 0 });
    }
});
export const setGrades = defineTool({
    name: "set_grades",
    title: "Poner notas en bloque",
    description: "Pone o borra (score null) las notas de varios estudiantes en una actividad calificable, en una sola llamada. Usa los user_id de list_members.",
    level: "team",
    readOnly: false,
    input: z.object({
        classroom_id: id("Aula"),
        item_id: id("Actividad calificable"),
        grades: z
            .array(z.object({ user_id: id("Estudiante"), score: z.number().min(0).max(1000).nullable(), note: z.string().max(400).optional() }))
            .min(1)
            .max(300)
    }),
    async run({ db }, input) {
        const { data: item } = await db
            .from("classroom_extras")
            .select("max_score")
            .eq("id", input.item_id)
            .eq("classroom_id", input.classroom_id)
            .maybeSingle();
        if (!item)
            throw new ToolError(NOT_FOUND);
        const max = Number(item.max_score ?? 5);
        const over = input.grades.filter((grade) => grade.score !== null && grade.score > max);
        if (over.length > 0)
            throw new ToolError(`${over.length} nota(s) superan el máximo (${max}).`);
        const clear = input.grades.filter((grade) => grade.score === null).map((grade) => grade.user_id);
        const put = input.grades.filter((grade) => grade.score !== null);
        if (clear.length > 0)
            await db.from("classroom_grades").delete().eq("extra_id", input.item_id).in("user_id", clear);
        if (put.length > 0) {
            const now = new Date().toISOString();
            const { error } = await db.from("classroom_grades").upsert(put.map((grade) => ({
                extra_id: input.item_id,
                user_id: grade.user_id,
                score: grade.score,
                note: grade.note?.trim() || null,
                updated_at: now
            })), { onConflict: "extra_id,user_id" });
            if (error)
                throw new ToolError("No pudimos guardar las notas.");
        }
        return { saved: put.length, cleared: clear.length };
    }
});
export const setAttendance = defineTool({
    name: "set_attendance",
    title: "Tomar asistencia",
    description: "Marca presentes y/o ausentes en una clase publicada del aula, en una sola llamada (user_id de list_members).",
    level: "team",
    readOnly: false,
    input: z.object({
        classroom_id: id("Aula"),
        meeting_id: id("Clase"),
        present: z.array(id("Estudiante")).max(500).default([]),
        absent: z.array(id("Estudiante")).max(500).default([])
    }),
    async run({ db }, input) {
        const { data: meeting } = await db
            .from("classroom_meetings")
            .select("is_published")
            .eq("id", input.meeting_id)
            .eq("classroom_id", input.classroom_id)
            .maybeSingle();
        if (!meeting)
            throw new ToolError(NOT_FOUND);
        if (!meeting.is_published)
            throw new ToolError("Publica la clase antes de tomar asistencia.");
        if (input.present.length === 0 && input.absent.length === 0)
            throw new ToolError("Indica present o absent.");
        if (input.absent.length > 0) {
            const { error } = await db.from("classroom_attendance").delete().eq("meeting_id", input.meeting_id).in("user_id", input.absent);
            if (error)
                throw new ToolError("No pudimos quitar asistencias.");
        }
        if (input.present.length > 0) {
            const { error } = await db.from("classroom_attendance").upsert(input.present.map((userId) => ({ meeting_id: input.meeting_id, user_id: userId })), { onConflict: "meeting_id,user_id", ignoreDuplicates: true });
            if (error)
                throw new ToolError("No pudimos marcar la asistencia.", "Solo se marca a estudiantes aprobados del aula.");
        }
        return { present: input.present.length, absent: input.absent.length };
    }
});
export const saveTeam = defineTool({
    name: "save_team",
    title: "Crear o editar un equipo",
    description: "Equipo de estudiantes del aula (tableros). members reemplaza la lista de integrantes (user_id de list_members).",
    level: "team",
    readOnly: false,
    input: z.object({
        classroom_id: id("Aula"),
        team_id: id("Equipo").optional(),
        name: text(60, "Nombre").optional(),
        color: z
            .string()
            .regex(/^#[0-9a-f]{6}$/i)
            .optional(),
        locked: z.boolean().optional(),
        members: z.array(id("Estudiante")).max(200).optional()
    }),
    async run({ db, actor }, input) {
        if (!input.team_id && !input.name)
            throw new ToolError("Un equipo nuevo necesita name.");
        const patch = defined({ name: input.name, color: input.color, locked: input.locked });
        const saved = input.team_id && Object.keys(patch).length === 0
            ? { id: input.team_id }
            : await upsertRow(db, "classroom_teams", input.classroom_id, input.team_id, patch, { created_by: actor.userId });
        if (input.members) {
            const { data: team } = await db
                .from("classroom_teams")
                .select("id")
                .eq("id", saved.id)
                .eq("classroom_id", input.classroom_id)
                .maybeSingle();
            if (!team)
                throw new ToolError(NOT_FOUND);
            await db.from("classroom_team_members").delete().eq("team_id", saved.id);
            if (input.members.length > 0) {
                await db.from("classroom_team_members").delete().eq("classroom_id", input.classroom_id).in("user_id", input.members);
                const { error } = await db
                    .from("classroom_team_members")
                    .insert(input.members.map((userId) => ({ team_id: saved.id, classroom_id: input.classroom_id, user_id: userId })));
                if (error)
                    throw new ToolError("Guardamos el equipo, pero no sus integrantes.");
            }
        }
        return { ...saved, ...(input.members ? { members: input.members.length } : {}) };
    }
});
const DELETABLE = {
    task: { table: "classroom_tasks", manager: false },
    meeting: { table: "classroom_meetings", manager: false },
    resource: { table: "classroom_resources", manager: true },
    survey: { table: "classroom_surveys", manager: false },
    period: { table: "classroom_periods", manager: false },
    grade_item: { table: "classroom_extras", manager: false },
    team: { table: "classroom_teams", manager: false },
    invite: { table: "classroom_invites", manager: false },
    forum_topic: { table: "classroom_posts", manager: false },
    forum_reply: { table: "classroom_replies", manager: false }
};
export const deleteClassroomItems = defineTool({
    name: "delete_classroom_items",
    title: "Borrar elementos del aula",
    description: "Borra varios elementos del aula del mismo tipo: task (y sus entregas), meeting, resource, survey (y sus votos), period, grade_item (y sus notas), team, invite, forum_topic (y sus respuestas) o forum_reply. Irreversible: muestra qué se borra y pide confirmación.",
    level: "team",
    readOnly: false,
    destructive: true,
    input: z.object({
        classroom_id: id("Aula"),
        kind: z.enum(Object.keys(DELETABLE)),
        ids: z.array(id("Elemento")).min(1).max(200),
        confirm
    }),
    async run({ db, actor }, input) {
        const spec = DELETABLE[input.kind];
        if (spec.manager)
            requireManager(actor, "borrar recursos");
        const ids = [...new Set(input.ids)];
        const { data } = input.kind === "forum_reply"
            ? await db
                .from("classroom_replies")
                .select("id, classroom_posts!inner(classroom_id)")
                .in("id", ids)
                .eq("classroom_posts.classroom_id", input.classroom_id)
            : await db.from(spec.table).select("id").in("id", ids).eq("classroom_id", input.classroom_id);
        const found = (data ?? []).map((row) => row.id);
        if (found.length !== ids.length)
            throw new ToolError(`${NOT_FOUND} (${ids.length - found.length} de ${ids.length})`, "Vuelve a listar para obtener los IDs actuales.");
        const { error } = await db.from(spec.table).delete().in("id", found);
        if (error)
            throw new ToolError("No pudimos borrar los elementos.");
        return { deleted: found.length, kind: input.kind };
    }
});

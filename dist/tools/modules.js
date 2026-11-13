import { z } from "zod";
import { ToolError } from "../domain/errors.js";
import { id, optionalMarkdown, optionalText, slugWithCode, text } from "../domain/sanitize.js";
import { defineTool } from "../mcp/tool.js";
import { nextPosition, ownedCourse, ownedModule, ownedSession } from "./ownership.js";
export const createModule = defineTool({
    name: "create_module",
    title: "Crear módulo",
    description: "Crea un módulo al final de un curso que puedes editar. Queda en borrador salvo que pidas publicarlo.",
    level: "team",
    readOnly: false,
    input: z.object({
        classroom_id: id("Aula"),
        course_id: id("Curso"),
        title: text(200, "Título del módulo"),
        objective: optionalText(1000, "Qué se lleva quien lo termina"),
        description: optionalMarkdown(20_000, "Descripción del módulo"),
        locked: z.boolean().default(false).describe("Bloqueado hasta que se abra manualmente"),
        opens_at: z.iso.datetime({ offset: true }).optional().describe("Fecha de apertura en ISO 8601"),
        kind: z.enum(["lecciones", "video"]).default("lecciones").describe("lecciones (lectura con quiz y juegos) o video"),
        publish: z.boolean().default(false).describe("Publicarlo de inmediato")
    }),
    async run({ db, actor }, input) {
        await ownedCourse(db, actor, input.classroom_id, input.course_id);
        const position = await nextPosition(db, "modules", "course_id", input.course_id);
        const { data, error } = await db
            .from("modules")
            .insert({
            course_id: input.course_id,
            title: input.title,
            slug: slugWithCode(input.title),
            objective: input.objective,
            description: input.description,
            kind: input.kind,
            is_published: input.publish,
            is_locked: input.locked,
            opens_at: input.opens_at ? new Date(input.opens_at).toISOString() : null,
            position,
            number: position
        })
            .select("id")
            .single();
        if (error || !data)
            throw new ToolError("No pudimos crear el módulo.");
        return { module_id: data.id, number: position, published: input.publish };
    }
});
const TABLES = { course: "courses", module: "modules", session: "sessions" };
export const setPublished = defineTool({
    name: "set_published",
    title: "Publicar o pasar a borrador",
    description: "Publica o pasa a borrador un curso, módulo o lección que puedes editar. Confirma con la persona antes de publicar.",
    level: "team",
    readOnly: false,
    input: z.object({
        classroom_id: id("Aula"),
        kind: z.enum(["course", "module", "session"]).describe("Qué se publica"),
        item_id: id("Elemento"),
        published: z.boolean().describe("true para publicar, false para borrador")
    }),
    async run({ db, actor }, input) {
        if (input.kind === "course")
            await ownedCourse(db, actor, input.classroom_id, input.item_id);
        else if (input.kind === "module")
            await ownedModule(db, actor, input.classroom_id, input.item_id);
        else
            await ownedSession(db, actor, input.classroom_id, input.item_id);
        const { error } = await db.from(TABLES[input.kind]).update({ is_published: input.published }).eq("id", input.item_id);
        if (error)
            throw new ToolError("No pudimos cambiar la publicación.");
        return { kind: input.kind, item_id: input.item_id, published: input.published };
    }
});

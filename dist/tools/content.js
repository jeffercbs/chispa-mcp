import { z } from "zod";
import { ToolError } from "../domain/errors.js";
import { id, markdown, optionalText, text, youtubeUrl } from "../domain/sanitize.js";
import { defineTool } from "../mcp/tool.js";
import { nextPosition, ownedModule } from "./ownership.js";
export const createLesson = defineTool({
    name: "create_lesson",
    title: "Crear lección",
    description: "Crea una lección (lectura, presentación con diapositivas o actividad) al final de un módulo de un curso que puedes editar. Queda en borrador salvo que pidas publicarla; confirma con la persona antes de publicar.",
    level: "team",
    readOnly: false,
    input: z.object({
        classroom_id: id("Aula"),
        module_id: id("Módulo"),
        title: text(200, "Título de la lección"),
        summary: optionalText(600, "Resumen de una o dos frases"),
        content: markdown(60_000, "Contenido en Markdown"),
        key_idea: optionalText(400, "La idea que debe quedar"),
        objectives: z.array(text(300, "Objetivo")).max(20).optional().describe("Objetivos de aprendizaje"),
        format: z
            .enum(["lectura", "presentacion", "actividad"])
            .default("lectura")
            .describe("«presentacion»: el contenido se parte en diapositivas con ---. Ver la sección PRESENTACIONES de las instrucciones."),
        video_url: z.string().max(300).optional().describe("Enlace de YouTube"),
        publish: z.boolean().default(false).describe("Publicarla de inmediato")
    }),
    async run({ db, actor }, input) {
        const { moduleId } = await ownedModule(db, actor, input.classroom_id, input.module_id);
        const video = input.video_url?.trim() ? youtubeUrl(input.video_url) : null;
        if (input.video_url?.trim() && !video)
            throw new ToolError("No reconocimos ese enlace de YouTube.");
        const position = await nextPosition(db, "sessions", "module_id", moduleId);
        const { data, error } = await db
            .from("sessions")
            .insert({
            module_id: moduleId,
            title: input.title,
            summary: input.summary,
            content: input.content,
            key_idea: input.key_idea,
            objectives: input.objectives ?? [],
            format: input.format,
            video_url: video,
            is_published: input.publish,
            position,
            number: position
        })
            .select("id")
            .single();
        if (error || !data)
            throw new ToolError("No pudimos crear la lección.");
        return { session_id: data.id, number: position, published: input.publish };
    }
});

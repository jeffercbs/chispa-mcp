import { z } from "zod";
import { dropBanner, storeBanner } from "../domain/banners.js";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { id } from "../domain/sanitize.js";
import { defineTool } from "../mcp/tool.js";
import { ownCollection } from "./collections.js";
import { ownedCourse } from "./ownership.js";
const sourceShape = {
    image_path: z.string().min(1).max(1024).optional().describe("Ruta de la imagen en este equipo (JPG, PNG, WEBP, GIF o AVIF)"),
    image_url: z.string().min(1).max(2000).optional().describe("Enlace https público de la imagen"),
    remove: z.literal(true).optional().describe("true quita la portada actual en lugar de subir una")
};
/** Exactamente una de las tres: ruta local, enlace o quitar. */
function pickAction(input) {
    const given = [input.image_path, input.image_url, input.remove].filter((value) => value !== undefined).length;
    if (given !== 1)
        throw new ToolError("Envía solo una opción: image_path, image_url o remove.");
    if (input.remove)
        return { remove: true };
    return { source: input.image_path !== undefined ? { path: input.image_path } : { url: input.image_url } };
}
const summary = (stored) => stored
    ? {
        banner_url: stored.url,
        format: "webp",
        width: stored.width,
        height: stored.height,
        size_kb: Math.round(stored.bytes / 1024),
        original_size_kb: Math.round(stored.original_bytes / 1024)
    }
    : { banner_url: null };
export const setCourseBanner = defineTool({
    name: "set_course_banner",
    title: "Portada del curso",
    description: "Sube o reemplaza la portada de un curso que puedes editar (o la quita con remove). La imagen se optimiza y se guarda como WebP liviano. Envía image_path (archivo en este equipo) o image_url (https público). Confirma con la persona antes de reemplazar una portada existente.",
    level: "team",
    readOnly: false,
    input: z.object({ classroom_id: id("Aula"), course_id: id("Curso"), ...sourceShape }),
    async run({ db, actor }, input) {
        const action = pickAction(input);
        await ownedCourse(db, actor, input.classroom_id, input.course_id);
        const { data } = await db.from("courses").select("banner_path").eq("id", input.course_id).maybeSingle();
        if (!data)
            throw new ToolError(NOT_FOUND);
        const previous = data.banner_path;
        const stored = "source" in action ? await storeBanner(db, actor.userId, action.source) : null;
        const { error } = await db
            .from("courses")
            .update({ banner_path: stored?.path ?? null })
            .eq("id", input.course_id);
        if (error) {
            if (stored)
                await dropBanner(db, stored.path);
            throw new ToolError("No pudimos guardar la portada del curso.");
        }
        await dropBanner(db, previous);
        return { course_id: input.course_id, ...summary(stored) };
    }
});
export const setCollectionBanner = defineTool({
    name: "set_collection_banner",
    title: "Portada de la colección",
    description: "Sube o reemplaza la portada de una colección tuya (o la quita con remove). La imagen se optimiza y se guarda como WebP liviano. Envía image_path (archivo en este equipo) o image_url (https público). Confirma con la persona antes de reemplazar una portada existente.",
    level: "none",
    readOnly: false,
    input: z.object({ collection_id: id("Colección"), ...sourceShape }),
    async run({ db, actor }, input) {
        const action = pickAction(input);
        await ownCollection(db, actor.userId, input.collection_id);
        const { data } = await db.from("course_collections").select("banner_path").eq("id", input.collection_id).maybeSingle();
        if (!data)
            throw new ToolError(NOT_FOUND);
        const previous = data.banner_path;
        const stored = "source" in action ? await storeBanner(db, actor.userId, action.source) : null;
        const { error } = await db
            .from("course_collections")
            .update({ banner_path: stored?.path ?? null })
            .eq("id", input.collection_id);
        if (error) {
            if (stored)
                await dropBanner(db, stored.path);
            throw new ToolError("No pudimos guardar la portada de la colección.");
        }
        await dropBanner(db, previous);
        return { collection_id: input.collection_id, ...summary(stored) };
    }
});

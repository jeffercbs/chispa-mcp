import { z } from "zod";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { id, optionalText, text } from "../domain/sanitize.js";
import { defineTool } from "../mcp/tool.js";
import { classroomCourseIds } from "./shared.js";
export async function requireMonetizable(db, classroomId) {
    const { data } = await db.rpc("classroom_can_monetize", { classroom: classroomId });
    if (!data)
        throw new ToolError("Esta aula todavía no tiene precios habilitados.");
}
export const listOffers = defineTool({
    name: "list_offers",
    title: "Ofertas del aula",
    description: "Lista las ofertas del aula con su tipo, descuento, vigencia, cupos y estado.",
    level: "comercio",
    readOnly: true,
    input: z.object({ classroom_id: id("Aula") }),
    async run({ db }, input) {
        const { data } = await db
            .from("course_offers")
            .select("*, course_offer_courses(course_id)")
            .eq("classroom_id", input.classroom_id)
            .order("created_at", { ascending: false });
        return {
            offers: (data ?? []).map((offer) => ({
                offer_id: offer.id,
                name: offer.name,
                kind: offer.kind,
                percent: offer.percent,
                amount: offer.amount,
                starts_at: offer.starts_at,
                ends_at: offer.ends_at,
                max_claims: offer.max_claims,
                active: offer.is_active,
                course_ids: (offer.course_offer_courses ?? []).map((item) => item.course_id)
            }))
        };
    }
});
const KINDS = ["porcentaje", "monto", "precio_fijo", "segundo_curso", "paquete"];
const offerShape = {
    name: text(120, "Nombre de la oferta"),
    description: optionalText(600, "Descripción visible"),
    kind: z.enum(KINDS).describe("Tipo de oferta"),
    percent: z.number().int().min(1).max(100).optional().describe("Porcentaje, para porcentaje y segundo_curso"),
    amount: z
        .number()
        .int()
        .min(0)
        .max(100_000_000)
        .optional()
        .describe("Valor en la moneda de la plataforma, para monto, precio_fijo y paquete"),
    course_ids: z.array(id("Curso")).min(1).max(50),
    starts_at: z.iso.datetime({ offset: true }).optional().describe("Inicio en ISO 8601"),
    ends_at: z.iso.datetime({ offset: true }).optional().describe("Fin en ISO 8601"),
    max_claims: z.number().int().min(1).max(1_000_000).optional().describe("Cupos")
};
const withOfferRules = (schema) => schema
    .refine((input) => (input.kind === "porcentaje" || input.kind === "segundo_curso" ? input.percent !== undefined : input.amount !== undefined), {
    error: "Indica el porcentaje o el valor según el tipo de oferta."
})
    .refine((input) => !(input.kind === "segundo_curso" || input.kind === "paquete") || input.course_ids.length >= 2, {
    error: "Esta oferta necesita al menos dos cursos."
})
    .refine((input) => !input.starts_at || !input.ends_at || input.ends_at > input.starts_at, {
    error: "La oferta tiene que terminar después de empezar."
});
async function offerRow(db, classroomId, input) {
    await requireMonetizable(db, classroomId);
    const linked = new Set(await classroomCourseIds(db, classroomId));
    const courseIds = [...new Set(input.course_ids)];
    if (courseIds.some((courseId) => !linked.has(courseId)))
        throw new ToolError(NOT_FOUND);
    const usesPercent = input.kind === "porcentaje" || input.kind === "segundo_curso";
    return {
        courseIds,
        row: {
            name: input.name,
            description: input.description,
            kind: input.kind,
            percent: usesPercent ? input.percent : null,
            amount: usesPercent ? null : input.amount,
            starts_at: input.starts_at ?? null,
            ends_at: input.ends_at ?? null,
            max_claims: input.max_claims ?? null
        }
    };
}
export const createOffer = defineTool({
    name: "create_offer",
    title: "Crear oferta",
    description: "Crea una oferta para cursos del aula: porcentaje, monto de descuento, precio fijo, descuento en el segundo curso o paquete. Queda pausada salvo que pidas activarla; confirma con la persona antes de activarla.",
    level: "comercio",
    readOnly: false,
    input: withOfferRules(z.object({ classroom_id: id("Aula"), ...offerShape, activate: z.boolean().default(false) })),
    async run({ db, actor }, input) {
        const { row, courseIds } = await offerRow(db, input.classroom_id, input);
        const { data, error } = await db
            .from("course_offers")
            .insert({ ...row, classroom_id: input.classroom_id, created_by: actor.userId, is_active: input.activate })
            .select("id")
            .single();
        if (error || !data)
            throw new ToolError("No pudimos crear la oferta.");
        const offerId = data.id;
        const { error: linkError } = await db
            .from("course_offer_courses")
            .insert(courseIds.map((courseId) => ({ offer_id: offerId, course_id: courseId })));
        if (linkError) {
            await db.from("course_offers").delete().eq("id", offerId);
            throw new ToolError("No pudimos guardar los cursos de la oferta.");
        }
        return { offer_id: offerId, active: input.activate };
    }
});
export const updateOffer = defineTool({
    name: "update_offer",
    title: "Editar oferta",
    description: "Reemplaza los datos de una oferta del aula (nombre, tipo, valor, cursos, vigencia y cupos). Envía todos los campos, no solo lo que cambia; consulta list_offers primero. El estado activo/pausado no cambia: usa set_offer_active.",
    level: "comercio",
    readOnly: false,
    input: withOfferRules(z.object({ classroom_id: id("Aula"), offer_id: id("Oferta"), ...offerShape })),
    async run({ db }, input) {
        const { data: existing } = await db
            .from("course_offers")
            .select("id")
            .eq("id", input.offer_id)
            .eq("classroom_id", input.classroom_id)
            .maybeSingle();
        if (!existing)
            throw new ToolError(NOT_FOUND);
        const { row, courseIds } = await offerRow(db, input.classroom_id, input);
        const { error } = await db.from("course_offers").update(row).eq("id", input.offer_id).eq("classroom_id", input.classroom_id);
        if (error)
            throw new ToolError("No pudimos guardar la oferta.");
        const { error: clearError } = await db.from("course_offer_courses").delete().eq("offer_id", input.offer_id);
        if (clearError)
            throw new ToolError("No pudimos guardar los cursos de la oferta.");
        const { error: linkError } = await db
            .from("course_offer_courses")
            .insert(courseIds.map((courseId) => ({ offer_id: input.offer_id, course_id: courseId })));
        if (linkError)
            throw new ToolError("No pudimos guardar los cursos de la oferta.");
        return { offer_id: input.offer_id };
    }
});
export const deleteOffer = defineTool({
    name: "delete_offer",
    title: "Borrar oferta",
    description: "Borra una oferta del aula. Irreversible: pide confirmación explícita a la persona.",
    level: "comercio",
    readOnly: false,
    destructive: true,
    input: z.object({
        classroom_id: id("Aula"),
        offer_id: id("Oferta"),
        confirm: z.literal(true).describe("Debe ser true: la persona confirmó")
    }),
    async run({ db }, input) {
        const { data, error } = await db
            .from("course_offers")
            .delete()
            .eq("id", input.offer_id)
            .eq("classroom_id", input.classroom_id)
            .select("id")
            .maybeSingle();
        if (error)
            throw new ToolError("No pudimos borrar la oferta.");
        if (!data)
            throw new ToolError(NOT_FOUND);
        return { deleted: true };
    }
});
export const setOfferActive = defineTool({
    name: "set_offer_active",
    title: "Activar o pausar una oferta",
    description: "Activa o pausa una oferta del aula. Confirma con la persona antes de activarla.",
    level: "comercio",
    readOnly: false,
    input: z.object({ classroom_id: id("Aula"), offer_id: id("Oferta"), active: z.boolean() }),
    async run({ db }, input) {
        const { data, error } = await db
            .from("course_offers")
            .update({ is_active: input.active })
            .eq("id", input.offer_id)
            .eq("classroom_id", input.classroom_id)
            .select("id")
            .maybeSingle();
        if (error)
            throw new ToolError("No pudimos cambiar el estado de la oferta.");
        if (!data)
            throw new ToolError(NOT_FOUND);
        return { offer_id: input.offer_id, active: input.active };
    }
});

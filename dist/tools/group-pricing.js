import { z } from "zod";
import { NOT_FOUND, ToolError } from "../domain/errors.js";
import { id } from "../domain/sanitize.js";
import { defineTool } from "../mcp/tool.js";
import { requireMonetizable } from "./offers.js";
import { classroomCourseIds, requireCourseInClassroom } from "./shared.js";
import { ownedCourse } from "./ownership.js";
/** Los mismos descuentos por defecto que usa la tienda cuando el curso no define los suyos. */
const DEFAULT_DISCOUNTS = [30, 35, 40, 45];
const MAX_EXTRA = 4;
const extraPrice = (unit, percent) => Math.round((unit * (100 - percent)) / 10_000) * 100;
function describe(row) {
    const mode = row.group_discounts === null ? "defecto" : row.group_discounts.length === 0 ? "desactivado" : "personalizado";
    const discounts = row.group_discounts ?? DEFAULT_DISCOUNTS;
    const price = row.price;
    return {
        course_id: row.id,
        title: row.title,
        price,
        mode,
        discounts_percent: mode === "desactivado" ? [] : discounts,
        // Ejemplo de cuánto se paga en total según el número de personas (la primera paga el precio completo).
        examples: price === null || mode === "desactivado"
            ? []
            : discounts.map((percent, index) => ({
                people: index + 2,
                percent_off_each_additional: percent,
                price_each_additional: extraPrice(price, percent),
                total: price + (index + 1) * extraPrice(price, percent)
            }))
    };
}
export const getGroupPricing = defineTool({
    name: "get_group_pricing",
    title: "Descuento por grupo",
    description: "Muestra el descuento por cantidad de personas de los cursos del aula (o de uno): quien compra paga el precio completo y cada persona adicional paga un porcentaje menos que crece con el tamaño del grupo (hasta 5 personas). Modos: «defecto» (30, 35, 40 y 45 %), «personalizado» o «desactivado».",
    level: "team",
    readOnly: true,
    input: z.object({ classroom_id: id("Aula"), course_id: id("Curso").optional() }),
    async run({ db, actor }, input) {
        let ids;
        if (input.course_id) {
            await ownedCourse(db, actor, input.classroom_id, input.course_id);
            ids = [input.course_id];
        }
        else {
            ids = await classroomCourseIds(db, input.classroom_id);
        }
        if (ids.length === 0)
            return { courses: [] };
        const { data } = await db.from("courses").select("id, title, price, group_discounts").in("id", ids).order("position");
        return { courses: (data ?? []).map(describe) };
    }
});
const discounts = z
    .array(z.number().int().min(0).max(90))
    .min(1)
    .max(MAX_EXTRA)
    .describe("% de descuento para 2, 3, 4 y 5 personas, en ese orden (por ejemplo [20, 25, 30, 35]). Hasta 4 valores, sin bajar de uno al siguiente.");
export const setGroupPricing = defineTool({
    name: "set_group_pricing",
    title: "Configurar descuento por grupo",
    description: "Define el porcentaje de descuento por cantidad de personas de un curso. «personalizado» exige discounts (para 2, 3, 4 y 5 personas, sin bajar de uno al siguiente); «defecto» vuelve a 30/35/40/45 %; «desactivado» deja de vender el curso para grupos. Cambia lo que paga el público: confirma el resultado con la persona antes de aplicarlo. El aula debe tener precios habilitados.",
    level: "team",
    readOnly: false,
    input: z
        .object({
        classroom_id: id("Aula"),
        course_id: id("Curso"),
        mode: z.enum(["defecto", "personalizado", "desactivado"]),
        discounts: discounts.optional()
    })
        .refine((input) => (input.mode === "personalizado") === (input.discounts !== undefined), {
        error: "Envía discounts solo con el modo «personalizado» (y es obligatorio en ese modo)."
    })
        .refine((input) => !input.discounts || input.discounts.every((value, index, all) => index === 0 || value >= (all[index - 1] ?? 0)), {
        error: "Los descuentos no pueden bajar al sumar personas."
    }),
    async run({ db, actor }, input) {
        await requireCourseInClassroom(db, input.classroom_id, input.course_id);
        await ownedCourse(db, actor, input.classroom_id, input.course_id);
        await requireMonetizable(db, input.classroom_id);
        const value = input.mode === "defecto" ? null : input.mode === "desactivado" ? [] : (input.discounts ?? []);
        const { data, error } = await db
            .from("courses")
            .update({ group_discounts: value })
            .eq("id", input.course_id)
            .select("id, title, price, group_discounts")
            .maybeSingle();
        if (error)
            throw new ToolError("No pudimos guardar el descuento por grupo.");
        if (!data)
            throw new ToolError(NOT_FOUND);
        return describe(data);
    }
});

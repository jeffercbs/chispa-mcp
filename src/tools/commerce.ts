import { z } from "zod";
import { id } from "../domain/sanitize.js";
import { defineTool } from "../mcp/tool.js";

type Sale = {
	status: string;
	amount_cents: number;
	paid_at: string | null;
	created_at: string;
	courses: { title: string | null; amount_cents: number }[];
};

export const salesSummary = defineTool({
	name: "sales_summary",
	title: "Resumen de ventas",
	description: "Totales de ventas pagadas del aula en un periodo y lo vendido por curso. No incluye datos de contacto de los compradores.",
	level: "manager",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula"), days: z.number().int().min(1).max(365).default(30).describe("Días hacia atrás") }),
	async run({ db, currency }, input) {
		const { data } = await db.rpc("classroom_sales", { room: input.classroom_id });
		const since = Date.now() - input.days * 86_400_000;
		const paid = ((data ?? []) as Sale[]).filter(
			(sale) => sale.status === "pagado" && new Date(sale.paid_at ?? sale.created_at).getTime() >= since
		);
		const byCourse = new Map<string, { title: string; sales: number; revenue: number }>();
		for (const sale of paid) {
			for (const course of sale.courses) {
				const title = course.title ?? "Curso eliminado";
				const row = byCourse.get(title) ?? { title, sales: 0, revenue: 0 };
				row.sales += 1;
				row.revenue += course.amount_cents / 100;
				byCourse.set(title, row);
			}
		}
		const revenue = paid.reduce((sum, sale) => sum + sale.amount_cents, 0) / 100;
		return {
			days: input.days,
			currency,
			purchases: paid.length,
			revenue,
			by_course: [...byCourse.values()].sort((a, b) => b.revenue - a.revenue)
		};
	}
});

type Ledger = {
	order_id: string;
	reference: string;
	status: string;
	created_at: string;
	paid_at: string | null;
	amount_cents: number;
	fee_cents: number;
	net_cents: number;
	courses: { title: string | null; amount_cents: number }[];
};

export const listSales = defineTool({
	name: "list_sales",
	title: "Registro de ventas",
	description:
		"Lista las compras del aula (pagadas, pendientes y fallidas) con referencia, montos, comisión y cursos. No incluye datos de contacto de los compradores.",
	level: "manager",
	readOnly: true,
	input: z.object({
		classroom_id: id("Aula"),
		status: z.string().max(30).optional().describe("Filtra por estado, por ejemplo pagado"),
		limit: z.number().int().min(1).max(200).default(50)
	}),
	async run({ db, currency }, input) {
		const { data } = await db.rpc("classroom_sales", { room: input.classroom_id });
		const rows = ((data ?? []) as Ledger[])
			.filter((sale) => !input.status || sale.status === input.status)
			.sort((a, b) => new Date(b.paid_at ?? b.created_at).getTime() - new Date(a.paid_at ?? a.created_at).getTime());
		return {
			total: rows.length,
			currency,
			sales: rows.slice(0, input.limit).map((sale) => ({
				reference: sale.reference,
				status: sale.status,
				created_at: sale.created_at,
				paid_at: sale.paid_at,
				amount: sale.amount_cents / 100,
				fee: sale.fee_cents / 100,
				net: sale.net_cents / 100,
				courses: sale.courses.map((course) => ({ title: course.title ?? "Curso eliminado", amount: course.amount_cents / 100 }))
			}))
		};
	}
});

export const salesFunnel = defineTool({
	name: "sales_funnel",
	title: "Embudo de ventas",
	description:
		"Cuántos carritos se abrieron, cuántos pagos se iniciaron y cuántos se pagaron, más lo abandonado por curso. Sin datos de contacto.",
	level: "manager",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula") }),
	async run({ db }, input) {
		const [{ data: sales }, { data: abandoned }] = await Promise.all([
			db.rpc("classroom_sales", { room: input.classroom_id }),
			db.rpc("classroom_abandoned", { room: input.classroom_id })
		]);
		const orders = (sales ?? []) as { status: string }[];
		const left = (abandoned ?? []) as { kind: string; course_title: string | null; amount_cents: number }[];
		const byCourse = new Map<string, { title: string; abandoned: number; amount: number }>();
		for (const row of left) {
			const title = row.course_title ?? "Curso eliminado";
			const entry = byCourse.get(title) ?? { title, abandoned: 0, amount: 0 };
			entry.abandoned += 1;
			entry.amount += row.amount_cents / 100;
			byCourse.set(title, entry);
		}
		return {
			carts: left.filter((row) => row.kind === "carrito").length + orders.length,
			payments_started: orders.length,
			paid: orders.filter((sale) => sale.status === "pagado").length,
			abandoned_by_course: [...byCourse.values()].sort((a, b) => b.abandoned - a.abandoned)
		};
	}
});

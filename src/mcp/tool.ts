import type { z } from "zod";
import type { Identity } from "../auth/identity.js";
import type { Actor, Level } from "../domain/access.js";
import type { Db } from "../domain/supabase.js";

export type ToolContext = { db: Db; identity: Identity; actor: Actor; currency: string };

export type Tool<Schema extends z.ZodObject = z.ZodObject> = {
	name: string;
	title: string;
	description: string;
	level: Level;
	input: Schema;
	readOnly: boolean;
	destructive?: boolean;
	run: (context: ToolContext, input: z.output<Schema>) => Promise<Record<string, unknown>>;
};

export function defineTool<Schema extends z.ZodObject>(tool: Tool<Schema>): Tool<Schema> {
	if (!/^[a-z][a-z0-9_]{2,63}$/.test(tool.name)) throw new Error(`Nombre de herramienta no válido: ${tool.name}`);
	if (tool.level !== "none" && !("classroom_id" in tool.input.shape)) throw new Error(`${tool.name} necesita classroom_id.`);
	return tool;
}

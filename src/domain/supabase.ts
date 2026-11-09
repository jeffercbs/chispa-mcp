import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Config } from "../config.js";

export type Db = SupabaseClient;

export function userClient(config: Pick<Config, "url" | "anonKey">, token?: string): Db {
	return createClient(config.url, config.anonKey, {
		global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
	});
}

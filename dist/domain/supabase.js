import { createClient } from "@supabase/supabase-js";
export function userClient(config, token) {
    return createClient(config.url, config.anonKey, {
        global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
}

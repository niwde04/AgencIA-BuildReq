import { createClient } from "@supabase/supabase-js";
import { ENV } from "./env";

let adminClient: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdminClient() {
  if (!ENV.supabaseUrl || !ENV.supabaseServiceKey) {
    throw new Error("Supabase Admin no esta configurado");
  }

  if (!adminClient) {
    adminClient = createClient(ENV.supabaseUrl, ENV.supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return adminClient;
}

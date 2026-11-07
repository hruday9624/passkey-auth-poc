// The one browser-side Supabase client. It exists only for the passkey ceremonies (WebAuthn must run in the
// browser). createBrowserClient writes the session into the same cookies the server client reads, so a finished
// ceremony is followed by the normal server actions. Built lazily on first use inside an event handler.
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (cached !== null) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Missing browser configuration");
  cached = createBrowserClient(url, key);
  return cached;
}

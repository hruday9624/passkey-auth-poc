import "server-only";
import { z } from "zod";

// Server-side settings. SUPABASE_SECRET_KEY bypasses row-level security: it is used only on the server, for the
// admin API and the service-role database functions, and no name here may start with NEXT_PUBLIC_.
const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  // Random, at least 32 characters each. TOKEN_PEPPER keys the hash of every setup-link token;
  // SESSION_COOKIE_SECRET signs the short-lived "an admin approved this" cookie.
  TOKEN_PEPPER: z.string().min(32),
  SESSION_COOKIE_SECRET: z.string().min(32),
});

export type Env = z.infer<typeof schema>;

export class ConfigError extends Error {}

export function getEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Names only, never values.
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].join(", ");
    throw new ConfigError(`Missing or invalid server configuration: ${names}`);
  }
  return parsed.data;
}

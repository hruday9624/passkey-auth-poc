import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/origin";
import { createUserClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Ends THIS browser's session only (other devices stay signed in).
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  try {
    await (await createUserClient()).auth.signOut({ scope: "local" });
  } catch {
    // Still send the person to the sign-in page; the cookies are cleared by the client call where possible.
  }
  // 303 so the browser follows with GET.
  return NextResponse.redirect(new URL("/", request.url), { status: 303, headers: { "Cache-Control": "no-store" } });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { provisionPasskeyUser } from "@/lib/provision";

export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  document_id: z.string().min(1).max(128),
  email: z.email().max(254),
  display_name: z.string().min(1).max(80).optional(),
});

/** Provision a passkey user upon E-Sign completion. */
export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const { document_id, email, display_name } = parsed.data;
  const fallbackName = email.split("@")[0] || "Member";

  const result = await provisionPasskeyUser({
    email,
    displayName: display_name ?? fallbackName,
    eventSource: "esign_webhook",
    idempotencyKey: `esign:${document_id}`,
    payload: raw as Record<string, unknown>,
  });

  if (result.status === "already_processed") {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }

  if (result.status === "failed") {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true, userId: result.userId, resendMessageId: result.resendMessageId },
    { status: 200 },
  );
}

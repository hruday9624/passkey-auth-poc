import "server-only";
import { randomBytes } from "node:crypto";
import { sendSetupLinkEmail } from "./email";
import { getEnv } from "./env";
import { originOf } from "./origin";
import { createServiceClient } from "./supabase/server";
import { generateToken, hashToken, LINK_TTL_SECONDS } from "./tokens";

export type ProvisionParams = {
  email: string;
  displayName: string;
  eventSource: "esign_webhook" | "admin";
  idempotencyKey: string;
  issuedBy?: string;
  origin?: string;
  payload?: Record<string, unknown>;
};

export type ProvisionResult =
  | { status: "email_sent"; userId: string; setupUrl: string; expiresAt: string; resendMessageId: string }
  | { status: "already_processed" }
  | { status: "failed"; error: string };

/** Idempotently provision a user, issue a setup link, and send the invite email. */
export async function provisionPasskeyUser(params: ProvisionParams): Promise<ProvisionResult> {
  const email = params.email.trim().toLowerCase();
  const displayName = params.displayName.trim();
  const actorId = params.eventSource === "admin" ? (params.issuedBy ?? null) : null;

  if (params.eventSource === "admin" && !actorId) {
    return { status: "failed", error: "Missing issuedBy for admin provisioning" };
  }

  const service = createServiceClient();
  const { data: eventId, error: beginError } = await service.rpc("begin_provisioning_event", {
    p_idempotency_key: params.idempotencyKey,
    p_source: params.eventSource,
    p_payload: params.payload ?? {},
  });

  if (beginError) {
    return { status: "failed", error: beginError.message };
  }
  if (typeof eventId !== "string" || !eventId) {
    return { status: "already_processed" };
  }

  let userId: string | null = null;

  try {
    const { data: existingId, error: findError } = await service.rpc("find_user_by_email", {
      p_email: email,
    });
    if (findError) throw new Error(findError.message);

    if (typeof existingId === "string" && existingId) {
      userId = existingId;
    } else {
      const created = await service.auth.admin.createUser({
        email,
        password: randomBytes(32).toString("base64url"),
        email_confirm: true,
      });
      if (created.error || !created.data?.user?.id) {
        throw new Error(created.error?.message ?? "Could not create auth user");
      }
      userId = created.data.user.id;
    }

    const { error: memberError } = await service.rpc("upsert_member", {
      p_user_id: userId,
      p_email: email,
      p_name: displayName,
      p_source: params.eventSource,
      p_actor: actorId,
    });
    if (memberError) throw new Error(memberError.message);

    const rawToken = generateToken();
    const tokenHmac = hashToken(rawToken, getEnv().TOKEN_PEPPER);

    const { data: expiresAt, error: linkError } = await service.rpc("issue_setup_link", {
      p_actor: actorId,
      p_user_id: userId,
      p_hmac: tokenHmac,
      p_ttl_seconds: LINK_TTL_SECONDS,
      p_source: params.eventSource,
      p_provisioning_event_id: params.eventSource === "esign_webhook" ? eventId : null,
    });
    if (linkError || typeof expiresAt !== "string") {
      throw new Error(linkError?.message ?? "Could not issue setup link");
    }

    const origin = params.origin ?? (await originOf());
    const setupUrl = `${origin}/enrol?t=${rawToken}`;

    const { messageId } = await sendSetupLinkEmail({
      to: email,
      recipientName: displayName,
      setupUrl,
    });

    const { error: finishError } = await service.rpc("finish_provisioning_event", {
      p_event_id: eventId,
      p_status: "email_sent",
      p_user_id: userId,
      p_resend_message_id: messageId,
      p_error_message: null,
    });
    if (finishError) throw new Error(finishError.message);

    return { status: "email_sent", userId, setupUrl, expiresAt, resendMessageId: messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provisioning failed";
    await service.rpc("finish_provisioning_event", {
      p_event_id: eventId,
      p_status: "failed",
      p_user_id: userId,
      p_resend_message_id: null,
      p_error_message: message,
    });
    return { status: "failed", error: message };
  }
}

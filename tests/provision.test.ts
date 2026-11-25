import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createUser: vi.fn(),
  sendSetupLinkEmail: vi.fn(),
  originOf: vi.fn(),
  getEnv: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    rpc: mocks.rpc,
    auth: { admin: { createUser: mocks.createUser } },
  }),
}));

vi.mock("@/lib/email", () => ({
  sendSetupLinkEmail: mocks.sendSetupLinkEmail,
}));

vi.mock("@/lib/origin", () => ({
  originOf: mocks.originOf,
}));

vi.mock("@/lib/env", () => ({
  getEnv: mocks.getEnv,
}));

import { provisionPasskeyUser } from "../src/lib/provision";

describe("provisionPasskeyUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.originOf.mockResolvedValue("https://app.example.com");
    mocks.getEnv.mockReturnValue({
      TOKEN_PEPPER: "p".repeat(32),
      SESSION_COOKIE_SECRET: "s".repeat(32),
    });
  });

  it("returns already_processed when idempotency key already exists", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await provisionPasskeyUser({
      email: "alice@example.com",
      displayName: "Alice",
      eventSource: "esign_webhook",
      idempotencyKey: "esign:doc_123",
    });

    expect(result).toEqual({ status: "already_processed" });
    expect(mocks.rpc).toHaveBeenCalledWith("begin_provisioning_event", {
      p_idempotency_key: "esign:doc_123",
      p_source: "esign_webhook",
      p_payload: {},
    });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.sendSetupLinkEmail).not.toHaveBeenCalled();
  });

  it("creates new user, upserts member, issues link, sends email, and marks email_sent", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: "evt-uuid-1", error: null }) // begin_provisioning_event
      .mockResolvedValueOnce({ data: null, error: null }) // find_user_by_email
      .mockResolvedValueOnce({ data: null, error: null }) // upsert_member
      .mockResolvedValueOnce({ data: "2026-11-25T14:00:00Z", error: null }) // issue_setup_link
      .mockResolvedValueOnce({ data: null, error: null }); // finish_provisioning_event

    mocks.createUser.mockResolvedValue({
      data: { user: { id: "user-uuid-1" } },
      error: null,
    });
    mocks.sendSetupLinkEmail.mockResolvedValue({ messageId: "msg_123" });

    const result = await provisionPasskeyUser({
      email: " Alice@Example.com ",
      displayName: "Alice",
      eventSource: "esign_webhook",
      idempotencyKey: "esign:doc_123",
    });

    expect(result.status).toBe("email_sent");
    if (result.status === "email_sent") {
      expect(result.userId).toBe("user-uuid-1");
      expect(result.resendMessageId).toBe("msg_123");
      expect(result.setupUrl).toMatch(/^https:\/\/app\.example\.com\/enrol\?t=[A-Za-z0-9_-]+$/);
    }

    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "alice@example.com",
        email_confirm: true,
      }),
    );

    expect(mocks.rpc).toHaveBeenCalledWith("upsert_member", {
      p_user_id: "user-uuid-1",
      p_email: "alice@example.com",
      p_name: "Alice",
      p_source: "esign_webhook",
      p_actor: null,
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "issue_setup_link",
      expect.objectContaining({
        p_actor: null,
        p_user_id: "user-uuid-1",
        p_source: "esign_webhook",
        p_provisioning_event_id: "evt-uuid-1",
      }),
    );

    expect(mocks.rpc).toHaveBeenCalledWith("finish_provisioning_event", {
      p_event_id: "evt-uuid-1",
      p_status: "email_sent",
      p_user_id: "user-uuid-1",
      p_resend_message_id: "msg_123",
      p_error_message: null,
    });
  });

  it("reuses existing user when find_user_by_email finds one and passes admin actor", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: "evt-uuid-2", error: null }) // begin_provisioning_event
      .mockResolvedValueOnce({ data: "existing-user-uuid", error: null }) // find_user_by_email
      .mockResolvedValueOnce({ data: null, error: null }) // upsert_member
      .mockResolvedValueOnce({ data: "2026-11-25T14:00:00Z", error: null }) // issue_setup_link
      .mockResolvedValueOnce({ data: null, error: null }); // finish_provisioning_event

    mocks.sendSetupLinkEmail.mockResolvedValue({ messageId: "msg_456" });

    const result = await provisionPasskeyUser({
      email: "bob@example.com",
      displayName: "Bob",
      eventSource: "admin",
      idempotencyKey: "admin:req_1",
      issuedBy: "admin-uuid-1",
    });

    expect(result.status).toBe("email_sent");
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("upsert_member", {
      p_user_id: "existing-user-uuid",
      p_email: "bob@example.com",
      p_name: "Bob",
      p_source: "admin",
      p_actor: "admin-uuid-1",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "issue_setup_link",
      expect.objectContaining({
        p_actor: "admin-uuid-1",
        p_user_id: "existing-user-uuid",
        p_source: "admin",
        p_provisioning_event_id: null,
      }),
    );
  });

  it("marks event failed when email sending throws", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: "evt-uuid-3", error: null }) // begin_provisioning_event
      .mockResolvedValueOnce({ data: "existing-user-uuid", error: null }) // find_user_by_email
      .mockResolvedValueOnce({ data: null, error: null }) // upsert_member
      .mockResolvedValueOnce({ data: "2026-11-25T14:00:00Z", error: null }) // issue_setup_link
      .mockResolvedValueOnce({ data: null, error: null }); // finish_provisioning_event

    mocks.sendSetupLinkEmail.mockRejectedValue(new Error("Resend timeout"));

    const result = await provisionPasskeyUser({
      email: "carol@example.com",
      displayName: "Carol",
      eventSource: "esign_webhook",
      idempotencyKey: "esign:doc_999",
    });

    expect(result).toEqual({ status: "failed", error: "Resend timeout" });
    expect(mocks.rpc).toHaveBeenCalledWith("finish_provisioning_event", {
      p_event_id: "evt-uuid-3",
      p_status: "failed",
      p_user_id: "existing-user-uuid",
      p_resend_message_id: null,
      p_error_message: "Resend timeout",
    });
  });
});

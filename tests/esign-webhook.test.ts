import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  provisionPasskeyUser: vi.fn(),
}));

vi.mock("@/lib/provision", () => ({
  provisionPasskeyUser: mocks.provisionPasskeyUser,
}));

import { POST } from "../src/app/api/webhooks/esign/route";

function makeRequest(body: unknown): Request {
  return new Request("https://app.example.com/api/webhooks/esign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/webhooks/esign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid payload", async () => {
    const res = await POST(makeRequest({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(mocks.provisionPasskeyUser).not.toHaveBeenCalled();
  });

  it("provisions user on valid payload and returns 200", async () => {
    mocks.provisionPasskeyUser.mockResolvedValue({
      status: "email_sent",
      userId: "user-123",
      setupUrl: "https://app.example.com/enrol?t=tok",
      expiresAt: "2026-11-25T14:00:00Z",
      resendMessageId: "msg_789",
    });

    const payload = {
      document_id: "doc_42",
      email: "signer@example.com",
      display_name: "Signer One",
    };

    const res = await POST(makeRequest(payload));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      userId: "user-123",
      resendMessageId: "msg_789",
    });

    expect(mocks.provisionPasskeyUser).toHaveBeenCalledWith({
      email: "signer@example.com",
      displayName: "Signer One",
      eventSource: "esign_webhook",
      idempotencyKey: "esign:doc_42",
      payload,
    });
  });

  it("returns 200 duplicate=true when already processed", async () => {
    mocks.provisionPasskeyUser.mockResolvedValue({ status: "already_processed" });

    const res = await POST(
      makeRequest({
        document_id: "doc_42",
        email: "signer@example.com",
        display_name: "Signer One",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
  });

  it("returns 500 when provisioning fails", async () => {
    mocks.provisionPasskeyUser.mockResolvedValue({ status: "failed", error: "Resend down" });

    const res = await POST(
      makeRequest({
        document_id: "doc_99",
        email: "signer@example.com",
        display_name: "Signer One",
      }),
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "Resend down" });
  });
});

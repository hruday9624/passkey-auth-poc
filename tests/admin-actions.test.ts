import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  provisionPasskeyUser: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("@/lib/provision", () => ({
  provisionPasskeyUser: mocks.provisionPasskeyUser,
}));

vi.mock("@/lib/supabase/server", () => ({
  createUserClient: async () => ({ rpc: mocks.rpc }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("next/navigation", () => ({
  unstable_rethrow: vi.fn(),
}));

import { adminAction } from "../src/app/admin/actions";

describe("adminAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({
      id: "admin-uuid-1",
      email: "admin@example.com",
      displayName: "Admin",
      isAdmin: true,
    });
  });

  it("delegates intent=add to provisionPasskeyUser and returns issued link", async () => {
    mocks.provisionPasskeyUser.mockResolvedValue({
      status: "email_sent",
      userId: "user-uuid-1",
      setupUrl: "https://app.example.com/enrol?t=tok123",
      expiresAt: "2026-11-25T14:00:00Z",
      resendMessageId: "msg_1",
    });

    const fd = new FormData();
    fd.set("intent", "add");
    fd.set("name", "Alice");
    fd.set("email", " Alice@Example.com ");

    const res = await adminAction({ error: null, issued: null }, fd);

    expect(res).toEqual({
      error: null,
      issued: {
        name: "Alice",
        email: "alice@example.com",
        link: "https://app.example.com/enrol?t=tok123",
        expiresAt: "2026-11-25T14:00:00Z",
      },
    });
    expect(mocks.provisionPasskeyUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "alice@example.com",
        displayName: "Alice",
        eventSource: "admin",
        issuedBy: "admin-uuid-1",
      }),
    );
    expect(mocks.provisionPasskeyUser.mock.calls[0]?.[0].idempotencyKey).toMatch(/^admin:/);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("delegates intent=link using member details from list_members RPC", async () => {
    const memberId = "11111111-1111-4111-8111-111111111111";
    mocks.rpc.mockResolvedValue({
      data: [{ user_id: memberId, email: "bob@example.com", display_name: "Bob" }],
      error: null,
    });
    mocks.provisionPasskeyUser.mockResolvedValue({
      status: "email_sent",
      userId: memberId,
      setupUrl: "https://app.example.com/enrol?t=tok456",
      expiresAt: "2026-11-25T14:05:00Z",
      resendMessageId: "msg_2",
    });

    const fd = new FormData();
    fd.set("intent", "link");
    fd.set("userId", memberId);

    const res = await adminAction({ error: null, issued: null }, fd);

    expect(res).toEqual({
      error: null,
      issued: {
        name: "Bob",
        email: "bob@example.com",
        link: "https://app.example.com/enrol?t=tok456",
        expiresAt: "2026-11-25T14:05:00Z",
      },
    });
    expect(mocks.provisionPasskeyUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "bob@example.com",
        displayName: "Bob",
        eventSource: "admin",
        issuedBy: "admin-uuid-1",
      }),
    );
  });

  it("returns error when provisionPasskeyUser fails", async () => {
    mocks.provisionPasskeyUser.mockResolvedValue({
      status: "failed",
      error: "Resend error",
    });

    const fd = new FormData();
    fd.set("intent", "add");
    fd.set("name", "Carol");
    fd.set("email", "carol@example.com");

    const res = await adminAction({ error: null, issued: null }, fd);

    expect(res.issued).toBeNull();
    expect(res.error).toBe("Resend error");
  });
});

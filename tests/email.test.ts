import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { sendSetupLinkEmail } from "../src/lib/email";

describe("sendSetupLinkEmail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  it("posts to Resend with click_tracking disabled and the setup URL", async () => {
    process.env.RESEND_API_KEY = "re_test_123";
    process.env.EMAIL_FROM = "Passkey App <noreply@example.com>";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "msg_abc123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendSetupLinkEmail({
      to: "alice@example.com",
      recipientName: "Alice",
      setupUrl: "https://app.example.com/enrol?t=rawtoken123",
    });

    expect(result).toEqual({ messageId: "msg_abc123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer re_test_123",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(String(init.body));
    expect(body.click_tracking).toBe(false);
    expect(body.from).toBe("Passkey App <noreply@example.com>");
    expect(body.to).toEqual(["alice@example.com"]);
    expect(body.subject).toBe("Set up your passkey");
    expect(body.text).toContain("https://app.example.com/enrol?t=rawtoken123");
    expect(body.html).toContain("https://app.example.com/enrol?t=rawtoken123");
    expect(body.html).toContain("Alice");
  });

  it("throws when Resend responds with an error", async () => {
    process.env.RESEND_API_KEY = "re_test_123";
    process.env.EMAIL_FROM = "noreply@example.com";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => '{"message":"Invalid domain"}',
      }),
    );

    await expect(
      sendSetupLinkEmail({
        to: "alice@example.com",
        recipientName: "Alice",
        setupUrl: "https://app.example.com/enrol?t=rawtoken123",
      }),
    ).rejects.toThrow(/Resend.*422/);
  });

  it("throws when RESEND_API_KEY is missing", async () => {
    await expect(
      sendSetupLinkEmail({
        to: "alice@example.com",
        recipientName: "Alice",
        setupUrl: "https://app.example.com/enrol?t=rawtoken123",
      }),
    ).rejects.toThrow(/RESEND_API_KEY/);
  });
});

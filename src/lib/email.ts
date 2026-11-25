import "server-only";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type SetupLinkEmailParams = {
  to: string;
  recipientName: string;
  setupUrl: string;
};

/** Send a one-time passkey setup link via Resend (click tracking disabled). */
export async function sendSetupLinkEmail(params: SetupLinkEmailParams): Promise<{ messageId: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY");
  }
  const from = process.env.EMAIL_FROM?.trim() || "Passkey Auth <onboarding@resend.dev>";

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: "Set up your passkey",
      click_tracking: false,
      text: `Hi ${params.recipientName},\n\nUse this one-time link (valid for 15 minutes) to set up your passkey:\n${params.setupUrl}\n\nOpen it in Safari or Chrome.`,
      html: `<p>Hi ${params.recipientName},</p><p>Use this one-time link (valid for 15 minutes) to set up your passkey:</p><p><a href="${params.setupUrl}">${params.setupUrl}</a></p><p>Open it in Safari or Chrome.</p>`,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend API error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { id?: unknown };
  if (typeof data.id !== "string" || !data.id) {
    throw new Error("Resend API returned no message id");
  }

  return { messageId: data.id };
}

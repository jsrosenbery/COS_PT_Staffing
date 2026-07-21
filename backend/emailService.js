const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || "console").trim().toLowerCase();
const EMAIL_FROM = process.env.EMAIL_FROM || "no-reply@cos.edu";
const APP_BASE_URL = (process.env.APP_BASE_URL || "").trim();

export function buildInviteUrl(token) {
  const base = APP_BASE_URL || process.env.CORS_ORIGIN?.split(",")?.[0]?.trim() || "";
  const path = `/accept-invite?token=${encodeURIComponent(token)}`;
  return base ? `${base.replace(/\/$/, "")}${path}` : path;
}

export async function sendEmail({ to, subject, text, html }) {
  if (!to) throw new Error("Email recipient is required.");

  if (EMAIL_PROVIDER !== "console") {
    console.warn(`EMAIL_PROVIDER=${EMAIL_PROVIDER} is configured, but no provider adapter is installed yet.`);
  }

  console.log("[email:console]", JSON.stringify({ from: EMAIL_FROM, to, subject, text, html }, null, 2));
  return { provider: "console", delivered: false };
}

export async function sendInviteEmail({ email, fullName, inviteUrl }) {
  const greeting = fullName ? `Hello ${fullName},` : "Hello,";
  return sendEmail({
    to: email,
    subject: "Set up your S.C.O.P.E. account",
    text: `${greeting}\n\nYou have been invited to S.C.O.P.E. Set your password here:\n${inviteUrl}\n\nThis link will expire automatically.`,
    html: `<p>${greeting}</p><p>You have been invited to S.C.O.P.E.</p><p><a href="${inviteUrl}">Set your password</a></p><p>This link will expire automatically.</p>`,
  });
}

const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || "console").trim().toLowerCase();
const EMAIL_FROM = process.env.EMAIL_FROM || "no-reply@cos.edu";
const APP_BASE_URL = (process.env.APP_BASE_URL || "").trim();

export function buildInviteUrl(token) {
  const base = APP_BASE_URL || process.env.CORS_ORIGIN?.split(",")?.[0]?.trim() || "";
  const path = `/accept-invite?token=${encodeURIComponent(token)}`;
  return base ? `${base.replace(/\/$/, "")}${path}` : path;
}

export function buildPasswordResetUrl(token) {
  const base = APP_BASE_URL || process.env.CORS_ORIGIN?.split(",")?.[0]?.trim() || "";
  const path = `/reset-password?token=${encodeURIComponent(token)}`;
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

export async function sendPasswordResetEmail({ email, fullName, resetUrl }) {
  const greeting = fullName ? `Hello ${fullName},` : "Hello,";
  return sendEmail({
    to: email,
    subject: "Reset your S.C.O.P.E. password",
    text: `${greeting}\n\nUse this link to reset your S.C.O.P.E. password:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>${greeting}</p><p>Use this link to reset your S.C.O.P.E. password:</p><p><a href="${resetUrl}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
  });
}

export async function sendAccountRequestNotice({ email, fullName }) {
  const greeting = fullName ? `Hello ${fullName},` : "Hello,";
  return sendEmail({
    to: email,
    subject: "S.C.O.P.E. account request received",
    text: `${greeting}\n\nYour account request was received and is pending review.`,
    html: `<p>${greeting}</p><p>Your account request was received and is pending review.</p>`,
  });
}

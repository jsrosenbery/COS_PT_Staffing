const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || "console").trim().toLowerCase();
const EMAIL_FROM = process.env.EMAIL_FROM || "no-reply@cos.edu";
const APP_BASE_URL = (process.env.APP_BASE_URL || "").trim();
const SENDGRID_API_KEY = (process.env.SENDGRID_API_KEY || "").trim();
const BREVO_API_KEY = (process.env.BREVO_API_KEY || "").trim();

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

function normalizeRecipients(to) {
  return Array.isArray(to)
    ? to.map((email) => String(email || "").trim()).filter(Boolean)
    : String(to || "").split(",").map((email) => email.trim()).filter(Boolean);
}

async function sendWithSendGrid({ to, subject, text, html }) {
  if (!SENDGRID_API_KEY) throw new Error("SENDGRID_API_KEY is required when EMAIL_PROVIDER=sendgrid.");
  const recipients = normalizeRecipients(to);
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: recipients.map((email) => ({ email })) }],
      from: { email: EMAIL_FROM },
      subject,
      content: [
        { type: "text/plain", value: text || "" },
        ...(html ? [{ type: "text/html", value: html }] : []),
      ],
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SendGrid send failed: ${response.status} ${body}`);
  }
  return { provider: "sendgrid", delivered: true, recipientCount: recipients.length };
}

async function sendWithBrevo({ to, subject, text, html }) {
  if (!BREVO_API_KEY) throw new Error("BREVO_API_KEY is required when EMAIL_PROVIDER=brevo.");
  const recipients = normalizeRecipients(to);
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: EMAIL_FROM },
      to: recipients.map((email) => ({ email })),
      subject,
      textContent: text || "",
      ...(html ? { htmlContent: html } : {}),
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brevo send failed: ${response.status} ${body}`);
  }
  return { provider: "brevo", delivered: true, recipientCount: recipients.length };
}

export async function sendEmail({ to, subject, text, html }) {
  if (!to) throw new Error("Email recipient is required.");

  if (EMAIL_PROVIDER === "sendgrid") {
    return sendWithSendGrid({ to, subject, text, html });
  }

  if (EMAIL_PROVIDER === "brevo") {
    return sendWithBrevo({ to, subject, text, html });
  }

  console.log("[email:console]", JSON.stringify({ from: EMAIL_FROM, to, subject, text, html }, null, 2));
  return { provider: "console", delivered: false, recipientCount: normalizeRecipients(to).length };
}

export async function sendInviteEmail({ email, fullName, inviteUrl }) {
  const greeting = fullName ? `Hello ${fullName},` : "Hello,";
  return sendEmail({
    to: email,
    subject: "Set up your SHERMAN account",
    text: `${greeting}\n\nYou have been invited to SHERMAN. Set your password here:\n${inviteUrl}\n\nThis link will expire automatically.`,
    html: `<p>${greeting}</p><p>You have been invited to SHERMAN.</p><p><a href="${inviteUrl}">Set your password</a></p><p>This link will expire automatically.</p>`,
  });
}

export async function sendPasswordResetEmail({ email, fullName, resetUrl }) {
  const greeting = fullName ? `Hello ${fullName},` : "Hello,";
  return sendEmail({
    to: email,
    subject: "Reset your SHERMAN password",
    text: `${greeting}\n\nUse this link to reset your SHERMAN password:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>${greeting}</p><p>Use this link to reset your SHERMAN password:</p><p><a href="${resetUrl}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
  });
}

export async function sendAccountRequestNotice({ email, fullName }) {
  const greeting = fullName ? `Hello ${fullName},` : "Hello,";
  return sendEmail({
    to: email,
    subject: "SHERMAN account request received",
    text: `${greeting}\n\nYour account request was received and is pending review.`,
    html: `<p>${greeting}</p><p>Your account request was received and is pending review.</p>`,
  });
}

export async function sendDisseminationEmail({ recipients, subject, body, html }) {
  return sendEmail({
    to: recipients,
    subject,
    text: body,
    html,
  });
}

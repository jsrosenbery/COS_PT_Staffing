import test from "node:test";
import assert from "node:assert/strict";

async function loadEmailService(env = {}) {
  const original = {
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    EMAIL_FROM: process.env.EMAIL_FROM,
    SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
    BREVO_API_KEY: process.env.BREVO_API_KEY,
  };
  Object.assign(process.env, env);
  const module = await import(`../emailService.js?test=${Date.now()}-${Math.random()}`);
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return module;
}

test("Brevo provider sends expected transactional email payload", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return { ok: true, text: async () => "" };
  };

  try {
    const { sendEmail } = await loadEmailService({
      EMAIL_PROVIDER: "brevo",
      BREVO_API_KEY: "xkeysib-test-brevo-key-that-is-long-enough",
      EMAIL_FROM: "jacoba@cos.edu",
    });
    const result = await sendEmail({
      to: ["faculty.one@example.edu", "faculty.two@example.edu"],
      subject: "Set up account",
      text: "Plain message",
      html: "<p>Plain message</p>",
    });

    assert.deepEqual(result, { provider: "brevo", delivered: true, recipientCount: 2 });
    assert.equal(captured.url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(captured.options.headers["api-key"], "xkeysib-test-brevo-key-that-is-long-enough");
    const body = JSON.parse(captured.options.body);
    assert.deepEqual(body.sender, { email: "jacoba@cos.edu" });
    assert.deepEqual(body.to, [{ email: "faculty.one@example.edu" }, { email: "faculty.two@example.edu" }]);
    assert.equal(body.subject, "Set up account");
    assert.equal(body.textContent, "Plain message");
    assert.equal(body.htmlContent, "<p>Plain message</p>");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Brevo provider requires an API key", async () => {
  const { sendEmail } = await loadEmailService({
    EMAIL_PROVIDER: "brevo",
    BREVO_API_KEY: "",
    EMAIL_FROM: "jacoba@cos.edu",
  });

  await assert.rejects(
    sendEmail({ to: "faculty@example.edu", subject: "Subject", text: "Text" }),
    /BREVO_API_KEY is required/
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { logout, setSession, setApiToken, getSessionToken, getApiToken, getCurrentUser } from "../src/apiClient.js";
import { signOutAndReset } from "../src/signOut.js";

for (const outcome of ["success", "server-error", "network-error"]) {
  test(`logout clears credentials and replaces workspace before ${outcome}`, async () => {
    const original = globalThis.fetch;
    let finish;
    let captured;
    globalThis.fetch = (_url, options) => {
      captured = options;
      return new Promise((resolve, reject) => { finish = () => outcome === "network-error" ? reject(new Error("offline")) : resolve(new Response(JSON.stringify(outcome === "success" ? { ok: true } : { error: "failed" }), { status: outcome === "success" ? 200 : 500, headers: { "content-type": "application/json" } })); });
    };
    try {
      setSession({ token: "synthetic-session" }, { id: 1 });
      setApiToken("synthetic-bootstrap");
      let reset = false;
      let message;
      const pending = signOutAndReset({ revoke: logout, resetWorkspace() {
        reset = true;
        assert.equal(getSessionToken(), "");
        assert.equal(getApiToken(), "");
        assert.equal(getCurrentUser(), null);
      }, report(value) { message = value; } });
      assert.equal(reset, true);
      assert.equal(message, undefined);
      assert.equal(captured.headers.get("Authorization"), "Bearer synthetic-session");
      assert.ok(captured.signal instanceof AbortSignal);
      finish();
      await pending;
      assert.match(message, outcome === "success" ? /^Signed out\.$/ : /could not be revoked/);
    } finally { globalThis.fetch = original; }
  });
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  clearApiToken,
  clearSession,
  getApiToken,
  getCurrentUser,
  getSessionToken,
  setApiToken,
  setSession,
} from "../src/apiClient.js";

test("authentication credentials are held in memory rather than browser storage", () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    sessionStorage: {
      getItem() { throw new Error("sessionStorage must not be read"); },
      setItem() { throw new Error("sessionStorage must not be written"); },
      removeItem() { throw new Error("sessionStorage must not be written"); },
    },
  };
  try {
    setApiToken("bootstrap-token");
    setSession({ token: "session-token" }, { id: 1, role: "faculty" });
    assert.equal(getApiToken(), "bootstrap-token");
    assert.equal(getSessionToken(), "session-token");
    assert.deepEqual(getCurrentUser(), { id: 1, role: "faculty" });
    clearApiToken();
    clearSession();
    assert.equal(getApiToken(), "");
    assert.equal(getSessionToken(), "");
    assert.equal(getCurrentUser(), null);
  } finally {
    globalThis.window = previousWindow;
  }
});

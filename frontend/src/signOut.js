export async function signOutAndReset({ revoke, resetWorkspace, report }) {
  // Capture the authenticated revocation request, then discard the entire
  // workspace immediately. Old component requests can only update the old mount.
  let request;
  try { request = Promise.resolve(revoke()); } catch (error) { request = Promise.reject(error); }
  resetWorkspace();
  try {
    await request;
    report("Signed out.");
  } catch {
    report("Signed out on this device. The server session could not be revoked; it may remain valid until it expires.");
  }
}

# Account continuity and notice recovery

Account edits and deletions cannot remove the last active administrator, including concurrent requests. Create and activate another administrator before demoting or disabling the final one. The API remains authoritative if the user-management screen is stale.

Signing out immediately clears browser credentials and remounts the workspace, discarding its loaded data even if server revocation fails. A warning explains when the server session could still be valid until expiration.

## Deploying notice recovery

Apply migration `0012_email_retry_payload.sql` before deploying the backend. It adds the saved message, recipient snapshot, and attempt count to email delivery records. Treat these database fields as personal data under the same access and retention controls as the faculty roster.

For production that must send email, configure `EMAIL_PROVIDER=brevo` or `sendgrid`, its API key, a verified `EMAIL_FROM`, and `EMAIL_DELIVERY_REQUIRED=true`. The last setting rejects console-only production configuration at startup. It defaults to false for compatibility with existing installations. Console mode never counts as provider acceptance.

## Retrying a failed staffing notice

Select its term and division in Admin Operations. A failed notice exposes **Retry Failed Notice**. A retry uses the original subject, saved message and recipients, existing staffing window, and original deadline. It does not create a new window or extend the response period. Closed or expired windows cannot be retried. Division access is checked on the server.

For notices created before migration 0012, supply the reviewed original message when prompted. These older records have no saved body or recipient snapshot; recovery captures the current active division roster and records that choice in the audit history.

**Accepted by provider** means the provider accepted the API request, not that each recipient received an inbox message. Check provider delivery events for bounces and delivery confirmation. Repeated or concurrent retry requests cannot send an already accepted notice again.

**Pending** can mean an attempt is in progress, its response was lost, or acceptance could not be recorded. Automatic retry is blocked because sending again could duplicate a message. An operator must reconcile the notice with provider logs and the audit trail before any database repair. Do not change pending to failed merely because the app timed out; confirm that the provider did not accept it and that no attempt is still running. This release does not add an automatic reconciliation service.

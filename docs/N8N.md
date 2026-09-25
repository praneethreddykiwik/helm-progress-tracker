# n8n workflow setup

## Delivery: workflows A–D

Import `n8n/notification-delivery.json` as one workflow. It handles new submissions/acknowledgments, explicit admin retest approvals, verified/reopened outcomes, and needs-information messages. The app supplies escaped HTML and plain text; each recipient has an independent delivery record.

1. In **Validate envelope**, set `APP_ORIGIN` to the exact public HTTPS app origin, with no trailing slash. The exact allowlist prevents webhook payloads from redirecting capability-bearing HTTP calls to another host.
2. In **Notification webhook**, create/select a Header Auth credential: header name `X-Helm-Webhook-Secret`, value a random secret. Put the same value in server `N8N_WEBHOOK_SECRET`.
3. In **Send via Resend**, select a Header Auth credential: header name `Authorization`, value `Bearer YOUR_RESEND_KEY`. Use a send-only key restricted to your sending domain when supported. The key belongs in credentials, not exported JSON.
4. Set server `EMAIL_FROM` to the verified sender and `INTEGRATION_BASE_URL` to the same app origin.
5. Publish only after configuration. Copy the production webhook URL into `N8N_WEBHOOK_URL` and start `npm run worker` on the application host.
6. Create one report with real admin/tester email accounts. Verify two notifications, then approve/retest with the tester. Inspect application notification records and Resend independently.

The workflow responds to webhooks immediately; HTTP success means n8n accepted the trigger, **not** that email was sent. The server waits for a callback. HTTP request timeouts are 20 seconds. Provider responses are classified as provider-accepted, failed, or uncertain. An uncertain response is retried only within the provider's deduplication window, with the same `helm/<delivery UUID>` key and immutable email payload.

Execution payload persistence is set to **none** for success and failure, with manual executions unsaved. Check these workflow settings after import, especially when pasting nodes instead of importing the complete file. App logs retain sanitized attempt outcomes/correlation IDs without email bodies or capabilities. Consider n8n's instance retention settings too.

## Reminders and digest: workflows E–F

Import `n8n/reminders-and-digest.json` separately.

1. Set the public HTTPS origin in **App URL**.
2. In **Schedule due notifications**, create/select a Header Auth credential with `Authorization: Bearer RANDOM_SCHEDULER_SECRET`.
3. Put the matching value in server `N8N_SCHEDULER_SECRET` (at least 32 characters).
4. Publish. The trigger runs every 15 minutes. The application uses the administrator's configured timezone/time for digest eligibility and elapsed time for reminders.

The default reminder interval is 48 hours, capped at two per cycle. Each scheduled request includes a timestamp and execution nonce; expired/replayed requests are rejected or ignored. Status/cycle is checked when queuing and again immediately before claiming an email. A status change cannot retract a message already accepted by the provider. The app never closes issues for inactivity.

## Safe checks

`n8n/contract-checks.json` runs 11 checks of the same envelope validation and provider outcome classification code used in the delivery workflow. It has no HTTP nodes and sends no email. This is not an end-to-end email test.

```sh
npm test
```

The repository also tests application transitions, permission boundaries, outbox outage handling, and replay/idempotency behavior. Check `docs/VERIFICATION.md` for exactly what ran against the actual n8n instance.

## Payload and callback

Sample dispatch (illustrative only; capability must be issued by the app):

```json
{
  "schema_version": 1,
  "delivery_id": "11111111-1111-4111-8111-111111111111",
  "event_id": "22222222-2222-4222-8222-222222222222",
  "capability": "64-character-hex-capability-issued-by-the-worker",
  "base_url": "https://your-app-domain",
  "timestamp": 1790265600000
}
```

`POST /api/integration/claim` with `Authorization: Bearer <capability>` returns `{ "send": false }` for an ineligible/duplicate notification or the fixed email body plus `idempotency_key` when claimed.

`POST /api/integration/outcome` with the same scoped capability:

```json
{
  "state": "provider-accepted",
  "provider_id": "id-returned-by-resend",
  "execution_id": "n8n-execution-id"
}
```

For an uncertain send use `state: uncertain, error: unknown_outcome`; a deterministic rejection uses `state: failed, error: provider_rejected`. Raw provider error details are never copied into public logs.

## Delivered and bounced

Configure Resend webhooks to `https://YOUR_APP/api/provider/resend` for `email.delivered` and `email.bounced`. Put the signing secret in `RESEND_WEBHOOK_SECRET`. The app uses Svix verification of the raw request body and timestamp. Provider-accepted remains a distinct state when no delivery webhook is configured.

## Verified official references

- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/
- https://raw.githubusercontent.com/n8n-io/n8n/master/packages/nodes-base/nodes/HttpRequest/V3/Description.ts
- https://raw.githubusercontent.com/n8n-io/n8n/master/packages/nodes-base/nodes/If/V2/IfV2.node.ts
- https://raw.githubusercontent.com/n8n-io/n8n/master/packages/nodes-base/nodes/Schedule/ScheduleTrigger.node.ts
- https://resend.com/docs/dashboard/emails/idempotency-keys
- https://resend.com/docs/webhooks/verify-webhooks-requests

References checked September 24, 2026. Provider idempotency is time-bounded (Resend: 24 hours); the app stops automatic retries after 23 hours from the first send claim to keep a safety margin. After that, an administrator must investigate provider records. There is no exactly-once delivery promise.

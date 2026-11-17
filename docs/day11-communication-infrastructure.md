# Day 11 — Communication infrastructure

Day 11 adds provider-independent channel records, official Meta WhatsApp Business Cloud API
onboarding, signed webhook ingestion, a shared inbox, server-authorized outbound messages, customer
and order linkage, assignment/handover, 24-hour service-window checks, opt-outs, media access and
multi-tenant audit records.

No message, customer, order, channel connection or delivery status is fabricated. All local test
traffic is explicitly simulated. A WhatsApp channel becomes genuinely connected only after a real
Meta Embedded Signup flow stores a real access token through the deployed Edge Function.

## Migration

- `supabase/migrations/20261123010000_day11_communication_infrastructure.sql`

The migration was applied directly to the linked Supabase project with
`node scripts/db-query.mjs <path>`, so it is not recorded in
`supabase_migrations.schema_migrations`. A follow-up corrected `communication_process_whatsapp_webhook`
to match customers from the webhook `from` phone number even when Meta also supplies `from_user_id`.

## Schema

| Object | Purpose |
| --- | --- |
| `public.communication_channels` | Provider-independent catalogue of available channel types. |
| `public.business_channel_connections` | One connection per business/channel/account, never a client secret. |
| `private.channel_credentials` | Access-token storage outside the `public` schema, service-role RPC access only. |
| `public.communication_conversations` | Shared inbox conversations with customer, assignee, status, unread and activity timestamps. |
| `public.communication_messages` | Inbound, outbound, text, template and media messages with provider identifiers and delivery state. |
| `public.communication_webhook_events` | Idempotency ledger for provider event keys and processing outcomes. |
| `public.communication_audit_log` | Assignment, status, opt-out and other important actions. |
| `public.communication_opt_outs` | Per-business, per-channel customer opt-out state. |

All public communication tables have Row Level Security enabled. Client grants are select-only where
the UI needs reads; all writes go through security-definer RPCs. Credentials are not selectable by
authenticated users and are never returned by client-facing functions.

## RPCs

Authenticated RPCs:

- `communication_list_channels`
- `communication_get_connection`
- `communication_disconnect_channel`
- `communication_list_assignable_users`
- `communication_list_conversations`
- `communication_get_conversation`
- `communication_list_messages`
- `communication_get_send_context`
- `communication_assign_conversation`
- `communication_set_conversation_status`
- `communication_mark_conversation_read`
- `communication_set_opt_out`
- `communication_create_outbound_message`
- `communication_finalize_outbound_message`
- `communication_fail_outbound_message`
- `communication_get_inbound_media`
- `communication_list_business_images`

Service-role RPCs:

- `communication_resolve_whatsapp_connection`
- `communication_get_channel_token`
- `communication_upsert_whatsapp_connection`
- `communication_set_connection_health`
- `communication_process_whatsapp_webhook`

The browser never calls service-role RPCs. Only deployed Edge Functions use the service-role key, and
only for the small set of server-side credential/webhook operations.

## Edge Functions

| Function | Purpose |
| --- | --- |
| `supabase/functions/whatsapp-connect/index.ts` | Exchanges the Embedded Signup code, validates the WABA/phone, subscribes to webhooks and stores credentials. |
| `supabase/functions/whatsapp-webhook/index.ts` | Handles Meta GET verification and signed POST webhook delivery. |
| `supabase/functions/whatsapp-webhook/signature.js` | HMAC-SHA256 verification shared by the Edge Function and Node test harness. |
| `supabase/functions/whatsapp-send/index.ts` | Sends text/template/image messages through the official Graph API and records queued/sent/failed state. |
| `supabase/functions/whatsapp-media/index.ts` | Retrieves inbound media through server-side token authorization and owner checks. |

Required Edge Function secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `META_APP_ID`
- `META_APP_SECRET`
- `META_WEBHOOK_VERIFY_TOKEN`
- `META_GRAPH_API_VERSION` (optional; defaults to `v25.0`)

Browser-safe variables:

- `VITE_META_APP_ID`
- `VITE_META_CONFIG_ID`
- `VITE_META_GRAPH_API_VERSION`
- `VITE_META_EMBEDDED_SIGNUP_VERSION`

Embedded Signup defaults to v4. Meta deprecated v2/v3 on `2026-10-15`. v4 remains the compatibility
target; v5 is available by setting `VITE_META_EMBEDDED_SIGNUP_VERSION=v5`. App ID and config ID are
public; app secret and webhook verify token are Edge Function secrets only.

## UI and client layer

| Path | Purpose |
| --- | --- |
| `src/features/channels/ChannelsPage.jsx` | WhatsApp connection status, connect/disconnect and provider availability. |
| `src/features/channels/embeddedSignup.js` | Facebook SDK loader and Embedded Signup launcher. |
| `src/features/inbox/InboxPage.jsx` | Conversation list, message history, customer/order panel, composer, assignment and status controls. |
| `src/services/communicationService.js` | Frontend API for channels, conversations, messages, send, media, assignment, status and opt-out. |
| `src/lib/env.js` | Public Meta config only. |

Routes:

| Route | Purpose |
| --- | --- |
| `/inbox` | Shared conversation inbox. |
| `/channels` | Channel connection management. |

## Webhook and message rules

- POST signatures are verified with `X-Hub-Signature-256` against `META_APP_SECRET` using Web Crypto
  and constant-time comparison.
- Provider message IDs are idempotency keys, so duplicate deliveries do not duplicate messages.
- Unknown phone-number IDs are ignored instead of being assigned to another business.
- Customer matching uses normalized `from` phone digits; display names alone never merge customers.
- 24-hour customer-service windows are computed from the latest inbound message. Free-form text is
  allowed inside the window; a template is required outside it.
- Opt-outs block outbound creation, and can be set by staff or removed by a customer reply.
- API acceptance is recorded as queued/sent only after the server call succeeds; `delivered` and
  `read` require real webhook status events.
- Image sends require a ready `media_asset` owned by the same business. The browser never fetches a
  provider token.
- Assignment and status changes are audited, and cross-business operations are denied by RPC checks
  and RLS.

## Tests

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:comms
```

The suite runs 101 checks using local payloads and direct database setup only. It covers signature
verification, channel visibility, credential protection, webhook verification/ingestion, duplicate
suppression, phone customer matching, name-only isolation, service-window/template rules, idempotent
sends, delivery/read/failure webhook states, opt-outs, media ownership, assignment/handover, history
pagination, inbound media authorization and cross-tenant denial. Every simulated payload is reported
as a local fixture, not a real Meta event.

Lint, production build, Days 3–10 regressions and the Day 11 suite pass. No Meta or Cloudinary live
flow was exercised.

## Current status

- Implemented: database schema, RPCs, RLS/grants, Edge Functions, client layer, UI, migration and
  automated local checks.
- Applied: `20261123010000_day11_communication_infrastructure.sql`, the corrected webhook function and
  the corrected message-history pagination function.
- Mock-tested: HMAC signatures and locally constructed Meta webhook payloads (101 checks).
- Not tested: real Meta embedded signup, real WABA connection, real outbound message, real webhook
  delivery, real media download, Edge Function deployment and production approval.
- Not connected: no real WhatsApp account is claimed until a real code exchange succeeds through the
  deployed function.

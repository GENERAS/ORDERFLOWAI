# Day 12 — AI Commerce Foundation

Day 12 adds a read-only AI commerce assistant that answers from verified OrderFlow AI records. It does not create orders, change stock, move inventory, record payments, mutate customers, send messages, or expose provider credentials to the browser.

## Status

- Database foundation and RPCs: implemented and applied to the linked Supabase project.
- Edge Function: implemented in `supabase/functions/ai-commerce-assistant/`, deployment is still required.
- Frontend: implemented at `/assistant`.
- Tests: `npm run test:ai` passes with 78 checks and 0 failures using local provider mocks.
- Real AI provider: not configured and not tested. The default provider is `none`, so the deployed function returns `PROVIDER_NOT_CONFIGURED` until secrets are configured.

## Architecture

```text
Browser (/assistant)
  -> src/services/aiAssistantService.js
  -> Supabase functions.invoke('ai-commerce-assistant')
  -> JWT verification + business membership RPC
  -> ai_get_assistant_access / ai_begin_assistant_request
  -> shared conversation context from Day 11 tables
  -> provider adapter (_shared/ai-provider.js)
  -> allowlisted read-only tools (_shared/ai-tools.js)
  -> business-scoped RPCs
  -> strict JSON answer + source validation
  -> ai_record_assistant_turn / ai_complete_assistant_request
```

The browser never calls an AI provider directly and never receives provider keys.

## Read-only tool surface

The assistant may call only:

- `search_products`
- `get_product_details`
- `get_product_variants`
- `check_product_availability`
- `get_business_information`
- `get_business_policies`
- `get_customer_order_status`

Every tool is validated before execution and every RPC is called with the authenticated user's Supabase client. Business id is always checked through membership RPCs, so a model-supplied business id cannot cross tenants.

`search_products` understands natural-language price clauses such as “under 20000”. Product images are signed only after `is_public_product_image` verifies that the product and image are publicly publishable.

## Conversation model

Day 12 reuses the Day 11 `communication_conversations` and `communication_messages` tables. AI sessions use an internal `ai_assistant` channel and are hidden from the Channels page and shared inbox UI.

When a conversation is assigned, resolved, archived, or has `assigned_to`, `ai_get_conversation_context` reports `aiMayRespond: false` and the Edge Function returns a handover response without calling the provider.

## Database changes

Migration: `supabase/migrations/20261124010000_day12_ai_commerce_foundation.sql`

Creates:

- `public.ai_assistant_settings`
- `public.ai_business_policies`
- `public.ai_assistant_requests`
- internal `communication_channels` row `ai_assistant`

Adds RPCs for access, settings, policies, business information, catalogue search, product details, variants, availability, customer order status, conversation context, test-conversation creation, assistant turns, usage start/completion, and request lookup.

All AI RPCs have RLS and explicit grants. `anon` cannot execute them. `ai_complete_assistant_request` is service-role-only.

## Provider configuration

The provider layer is deliberately provider-independent. Default is `none`.

To enable an OpenAI-compatible provider as an Edge Secret:

```bash
supabase secrets set AI_PROVIDER=openai_compatible
supabase secrets set AI_API_KEY=your-server-side-key
supabase secrets set AI_BASE_URL=https://api.provider.example/v1
supabase secrets set AI_MODEL=your-model-name
```

Optional secrets:

- `AI_TIMEOUT_MS` — default `20000`
- `AI_MAX_OUTPUT_TOKENS` — default `700`
- `AI_JSON_MODE` — default true; set to `false` to disable `response_format`
- `AI_ALLOWED_ORIGINS` — comma-separated CORS allowlist
- `AI_COST_PER_MILLION_INPUT_TOKENS`
- `AI_COST_PER_MILLION_OUTPUT_TOKENS`

Daily request and token limits are not Edge secrets. They are stored per business in `public.ai_assistant_settings` and changed by owners/admins through `public.ai_upsert_assistant_settings(...)`; defaults are `100` requests and `200000` tokens per database day.

Never put these values in `.env.local` or any `VITE_` variable.

## Deployment

The user handles deployment. The Edge Function must be deployed separately:

```bash
supabase functions deploy ai-commerce-assistant --no-verify-jwt
```

`--no-verify-jwt` is used because the function performs explicit bearer-token verification and then creates a user-scoped Supabase client. The service-role key is used only for usage completion and signed public image URLs.

## Tests

Run:

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:ai
```

Coverage includes provider configuration, timeout/rate-limit mapping, cost estimation, tool validation, language detection, strict JSON parsing, settings and policy RPCs, cross-tenant denial, anon denial, catalogue grounding, price filters, handover pause, assistant-turn persistence, idempotent request keys, daily limits, disabled-assistant behavior, and RLS row visibility.

No real AI provider call is included. Provider responses are local fixtures.

## Known boundaries

- No claim is made that a real AI provider, WhatsApp account, or Cloudinary account is live.
- The assistant cannot act on an answer; it only returns grounded information.
- The model is instructed to treat all stored text and customer messages as untrusted data.
- Tool output is still untrusted; source ids and product visibility are re-validated server-side before being returned.

# Day 13 — AI Commerce Actions and Order Preparation

Day 13 adds controlled order preparation to OrderFlow AI. The assistant may create drafts, recalculate quotes and present a quote for review. It never gives final approval, reserves stock, records payment or marks an order fulfilled.

## Rule

`The AI prepares. The customer confirms. The business approves. The backend executes authorized operations.`

No success message is allowed unless the corresponding backend RPC succeeded and returned the verified state.

## Migration

Applied manually to the linked Supabase project:

- `supabase/migrations/20261125010000_day13_ai_commerce_actions_schema.sql`
- `supabase/migrations/20261125010001_day13_ai_commerce_actions_helpers.sql`
- `supabase/migrations/20261125010002_day13_ai_commerce_actions_rpcs.sql`

The helper migration also fixes Day 12 `ai_get_customer_order_status` to read `order_items.product_name_snapshot` instead of the non-existent `name_snapshot`.

## Database changes

`orders` gains source, channel, conversation, discount, delivery, tax, delivery instructions, explicit customer confirmation and reconfirmation fields. `sync_order_totals()` now calculates `subtotal - discount + delivery + tax`.

New tables:

- `ai_order_charge_settings` — DB-backed optional discount, delivery fee and tax rate.
- `ai_order_quotes` — versioned quote snapshots with presented/accepted/expired state.
- `ai_order_quote_items` — verified price, quantity, snapshot and availability at quote time.
- `ai_order_preparations` — draft lifecycle, confirmation evidence and approval/rejection audit.
- `ai_order_idempotency` — repeat-safe action results per business.
- `ai_order_action_log` — actor, role, source, channel and action details.

All new tables have RLS, authenticated select policies and no anon access. Mutating RPCs validate business membership and role server-side.

## Workflow

1. Assistant calls `prepare_order_draft`; a normal `draft` order is created using existing orders and order items.
2. `calculate_order_quote` snapshots verified prices and stock into a draft quote.
3. `request_customer_confirmation` presents a fresh quote, sets `awaiting_confirmation` and asks for review.
4. Customer's exact message is passed to `submit_confirmed_order_for_business_approval`; ambiguous text is rejected.
5. If price or availability changed, the old quote is expired, a new quote is presented and reconfirmation is required.
6. Customer confirmation sets `awaiting_business_approval` only. No stock is reserved.
7. Owner/admin/manager approves from the Orders dashboard. The existing `update_order_status(..., 'confirmed')` transition reserves stock.
8. Rejection, clarification and cancellation use existing lifecycle/cancellation paths and are audited in Day 13 tables.

## Tool surface

The Edge Function adds allowlisted tools for `get_customer_information`, `prepare_order_draft`, `update_order_draft`, `calculate_order_quote`, `get_order_summary`, `request_customer_confirmation`, `submit_confirmed_order_for_business_approval` and `ai_search_order_preparations`.

`approve_prepared_order`, `reject_prepared_order`, `request_order_clarification` and `cancel_order_draft` are business-side RPCs and are not exposed as model tools.

Every mutation receives an Edge-generated idempotency key. Customer confirmation text comes from the current request message, not from model-authored text.

## Safety

- Human handover blocks order tools.
- Cross-business access is denied by membership-scoped RPCs.
- Model-supplied prices, totals, statuses, payment states and approval flags are rejected by validators.
- Quotes are revalidated before customer confirmation and again before business approval.
- The AI cannot approve an order or call stock/payment RPCs.

## Frontend

- `/assistant` shows draft/quote/confirmation/approval state and clearly labels that no stock changed.
- `/orders` shows a customer-confirmed AI order queue with approve, clarify and reject actions. Approval uses the existing lifecycle, so the backend reserves stock.

## Tests

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:ai
npm run test:ai-actions
```

Day 13 tests cover tool validation, prompt safety, draft creation, idempotency, cross-tenant denial, anon denial, configured charges, versioned quotes, explicit confirmation, stale-quote reconfirmation, handover, role-gated approval, stock only on approval, rejection, clarification, cancellation, search and the Day 12 snapshot fix.

No real AI provider is called. Provider checks use local fixtures.

## Boundaries

- No real AI provider is configured or claimed live.
- The deployed Edge Function still needs redeployment after these code changes.
- Customer-facing WhatsApp/storefront message delivery is out of scope; this day covers the channel-independent engine and business approval UI.
- No payment, refund or fulfilment action is added.

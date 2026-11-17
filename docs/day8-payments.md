# Day 8 — Payment management

Day 8 adds an independent payment module. Payments, refunds and payment history are derived
separately from order fulfilment: fulfilling an order never marks it paid, and verifying a payment
never changes the order lifecycle.

## Files

- `supabase/migrations/20261120010000_day8_payment_management.sql`
- `src/services/paymentService.js`
- `src/features/payments/PaymentsPage.jsx`
- `src/features/payments/RecordPaymentPage.jsx`
- `src/features/payments/PaymentDetailPage.jsx`
- `src/features/payments/components/PaymentActionDialogs.jsx`
- `src/features/payments/paymentUtils.js`
- `src/types/index.js`
- `src/utils/format.js`
- `scripts/day8-payment-tests.mjs`

## Routes

| Route | Purpose |
| --- | --- |
| `/payments` | Payment metrics, directory, filters, sorting and pagination. |
| `/payments/new` | Record a payment; accepts `?orderId=` to preselect a payable order. |
| `/payments/:paymentId` | Payment record, order summary, actions, refunds and event history. |

The order detail page also shows derived payment status, net paid, balance due, pending verification
and requested refund amounts. It links to the record-payment form when the order is eligible and has
a balance.

## Data model

### Payment methods

Each business receives `cash`, `bank_transfer`, `mobile_money`, `card` and `other` through an
after-insert trigger. Existing businesses were seeded by the migration. Method rows are readable by
active members and not writable from the browser.

### Payments

Payment numbers use a per-business atomic counter (`PAY-00001`). Payment rows snapshot the method
label, amount, currency, actor, references and provider metadata. Record statuses are:

- `pending` — recorded, not counted toward the balance.
- `verified` — counted toward the balance.
- `rejected` — reviewed and not counted.
- `failed` — failed externally and not counted.

Amounts must be positive, have at most two decimals and fit the outstanding verified balance.
Payment dates cannot be in the future. Notes, transaction references and provider references have
database-enforced length limits.

Idempotency keys prevent duplicate submissions. A repeated key with the same order, amount and
method returns the original payment; a conflicting payload is rejected. Provider event IDs are
unique per business and provider.

### Order payment status

The status is derived on read from the order total, verified payments, completed refunds, failed
payments and pending payments:

| Status | Meaning |
| --- | --- |
| `pending` | No verified payment and no failed-only state. |
| `partially_paid` | Some verified value, below the order total. |
| `paid` | Verified value covers the order total. |
| `failed` | Only failed payment value, with no pending value. |
| `partially_refunded` | Completed refunds exist and value remains paid. |
| `refunded` | Completed refunds cover the verified value. |

There is no payment-status column on `orders`, so the two lifecycles cannot drift through duplicated
state.

### Refunds

Refund records use `requested`, `completed` and `rejected`. A requested refund reserves part of the
payment's refundable value but does not reduce net paid. Completing a refund reduces net paid;
rejecting it releases the reservation. Refunds are only allowed for verified payments and cannot
exceed the remaining refundable amount.

Refund idempotency works like payment idempotency. Refund reasons are required and audited.

### History

`payment_events` records `created`, `verified`, `rejected`, `failed`, `refund_requested`,
`refund_completed` and `refund_rejected` with actor snapshots and JSON details. The table is
select-only and has an update trigger that denies all changes.

## RPCs

| RPC | Purpose |
| --- | --- |
| `list_payment_methods` | Active methods for a business. |
| `record_payment` | Validate and insert a pending payment. |
| `verify_payment` | Mark a pending payment verified after rechecking the balance. |
| `reject_payment` | Reject a pending payment with a reason. |
| `fail_payment` | Mark a pending payment failed with a reason. |
| `request_refund` | Reserve refundable value on a verified payment. |
| `complete_refund` | Complete a requested refund. |
| `reject_refund` | Reject a requested refund. |
| `get_payment` | Payment detail with refund totals. |
| `search_payments` | Search, filters, sorting and pagination. |
| `get_order_payment_summary` | Derived balances and status for one order. |
| `search_payable_orders` | Eligible orders with a remaining balance. |
| `get_payment_overview` | Currency-aware metrics grouped by currency. |

All writes are security-definer RPCs. The browser can select payment tables but cannot insert,
update or delete payment records, refunds, events or counters.

## Roles

| Action | Active roles allowed |
| --- | --- |
| Read payments, methods, refunds and history | owner, admin, manager, staff |
| Record a payment | owner, admin, manager, staff |
| Request a refund | owner, admin, manager, staff |
| Verify / reject / fail a payment | owner, admin, manager |
| Complete / reject a refund | owner, admin, manager |

## Reporting

`get_payment_overview` returns separate rows per currency. It reports record counts and amounts by
status, completed and requested refund totals, outstanding order value and the number of payable
orders. Outstanding value uses verified payments minus completed refunds; pending, failed and
rejected payments never reduce it.

`formatCurrency` uses currency-native fraction digits so integer-only currencies do not show
misleading decimals while currencies such as USD and RWF format according to their configured
precision.

## Migration notes

Apply the migration manually and load the database password first:

```powershell
. .\scripts\load-supabase-db-password.ps1
node scripts/db-query.mjs supabase/migrations/20261120010000_day8_payment_management.sql
```

Migrations in this project are applied manually and are not recorded in
`supabase_migrations.schema_migrations`.

## Tests

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:payments
```

The 199-check suite covers:

- Payment method seeding and tenant isolation.
- Anonymous and cross-tenant denial for tables and RPCs.
- Draft/cancelled order payment denial and eligible order states.
- Amount, date, method, note and reference validation.
- Pending, verified, rejected and failed payment flows.
- Staff/manager/owner role checks.
- Partial payment, overpayment and balance-recheck behaviour.
- Refund validation, reservation, completion, rejection and idempotency.
- Payment/order status independence and derived payment statuses.
- Payable-order search, filtering and pagination.
- Payment search, filters, sorting, pagination and invalid input handling.
- Currency-aware overview metrics and refund totals.
- Sequential numbering and provider-event uniqueness.
- Immutable history and direct-write denial.
- Full cleanup of test users, businesses, payments, refunds and order data.

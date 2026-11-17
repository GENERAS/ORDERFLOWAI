# Day 7 - Order management

## Scope

Day 7 turns the Orders placeholder into a working multi-tenant order module. It adds:

- Draft orders linked to a customer in the same business, or to a walk-in guest without a customer record.
- Catalogue items with quantity and server-authoritative pricing, plus preserved snapshots.
- Sequential per-business order numbers (`ORD-00001`, `ORD-00002`, ...).
- A strict order lifecycle with customer confirmation and business approval, ending in fulfilment or cancellation.
- Automatic stock reservation, release and consumption through the Day 5 ledger.
- Immutable order activity history for creation, edits, confirmation, approval, stock changes, fulfilment and cancellation.
- Server-side order search, status/date filtering, sorting and pagination.
- Order list metrics, a create/edit editor, an order detail page and a cancellation dialog.
- Real recent-order history on customer detail pages.

Day 7 does not add payments, invoices, fulfilment integrations or AI order extraction. Those remain
later phases.

## Migration

| Migration | Purpose |
| --- | --- |
| `20261117010000_day7_order_management.sql` | Order tables, counters, constraints, indexes, RLS, stock integration and RPCs. |
| `20261119010000_day7_order_lifecycle_guests.sql` | Customer/business approval split, guest orders, server pricing, date filters and stock events. |

Both migrations have been applied to the linked Supabase project. They are applied through
`scripts/db-query.mjs`; the project's migration history table is not used for these local migrations.

## Data model

| Table | Purpose |
| --- | --- |
| `order_counters` | Per-business sequence used to generate order numbers. |
| `orders` | Order header, customer snapshots, status, totals and lifecycle dates. |
| `order_items` | Ordered units with server-captured prices and catalogue snapshots. |
| `order_events` | Append-only activity history for each order. |

### `orders`

- `business_id`, `order_number`, optional `customer_id`, `status`, `stock_state`, `currency`.
- Walk-in orders leave `customer_id` null and store guest contact details in the customer snapshots.
  Linked orders use a composite foreign key so the customer is always in the same business.
- `customer_name_snapshot`, `customer_phone_snapshot` and `customer_email_snapshot` preserve the
  customer or guest details used when the order was created or last edited.
- `subtotal` and `total` are recalculated by a trigger from `order_items.line_total`.
- `notes` are optional and limited to 2,000 characters.
- `cancellation_reason` is required for cancelled orders and limited to 500 characters.
- `confirmed_at`, `completed_at` and `cancelled_at` record lifecycle milestones.
- `created_by` and `updated_by` reference the acting auth user.
- `(business_id, order_number)` is unique.

### `order_items`

- `product_id` and optional `variant_id`, both scoped to the same business and product.
- `product_name_snapshot`, `variant_name_snapshot` and `sku_snapshot` preserve catalogue details.
- `unit_price` is resolved by the server from the product or variant catalogue. Client-supplied
  `unit_price`, `unitPrice` or `line_total` values are rejected rather than trusted.
- `quantity` is between 1 and 100,000.
- `line_total` is generated as `quantity * unit_price`.
- `reserved_quantity` tracks how much of the line currently holds stock.
- A unique index prevents the same product/variant pair appearing twice in one order.

### `order_events`

- Event types: `created`, `updated`, `status_changed`, `customer_confirmed`, `business_approved`,
  `stock_reserved`, `stock_released`, `stock_consumed`, `fulfilled` and `cancelled`.
- Each event stores a human-readable summary, structured details, actor id and actor name snapshot.
- Updates are blocked by a database trigger; the browser has no write grant.
- Deletion is not exposed to clients. Rows cascade with their order or business so test and tenant
  cleanup remain possible.

## Order lifecycle

```text
draft -> awaiting_confirmation -> awaiting_business_approval -> confirmed
                                                               -> processing -> ready -> completed
   \_____________________________________________________________/
                              |
                           cancelled
```

- Only `draft` and `awaiting_confirmation` orders can be edited.
- `awaiting_confirmation` records the customer's confirmation; `awaiting_business_approval` is the
  business approval gate before stock is reserved.
- Status changes use `update_order_status` and must follow the next allowed step. Statuses cannot be
  skipped or repeated.
- Business approval (`confirmed`) and fulfilment (`completed`) require owner, admin or manager.
  Staff can create, edit, send for customer confirmation, process, mark ready and cancel.
- Cancellation uses `cancel_order` with a reason. Completed and already-cancelled orders cannot be
  cancelled.
- Business approval records `confirmed_at`; fulfilment records `completed_at`; cancellation records
  `cancelled_at` and the reason.

## Stock rules

| Order event | Stock behaviour | `stock_state` |
| --- | --- | --- |
| Created or edited before business approval | No stock movement. | `none` |
| Business approved (`confirmed`) | Reserve each tracked line through the Day 5 ledger. | `reserved` |
| Cancelled while reserved | Release all reserved units. | `released` |
| Fulfilled (`completed`) while reserved | Release the reservation, then reduce physical stock. | `consumed` |
| Cancelled before business approval | No stock movement. | remains `none` |

- Untracked catalogue units are ordered without stock movements.
- Reservations are rejected if available inventory is insufficient, so an order cannot be approved
  into an oversold state.
- Stock operations use deterministic idempotency keys derived from the order and item, preventing
  duplicate ledger entries.
- Completion removes sold units from physical inventory while keeping the movement history intact.

## Order numbers

- `next_order_number` increments `order_counters` atomically under a row lock.
- The first order in a business is `ORD-00001`; numbering is independent for every business.
- Numbers are generated inside `create_order`, so concurrent order creation cannot produce duplicates.

## Roles and RLS

| Action | Owner | Admin | Manager | Staff |
| --- | --- | --- | --- | --- |
| Read orders, items and activity | Yes | Yes | Yes | Yes |
| Create/edit draft orders | Yes | Yes | Yes | Yes |
| Customer confirmation, processing and ready | Yes | Yes | Yes | Yes |
| Business approval (`confirmed`) and fulfilment (`completed`) | Yes | Yes | Yes | No |
| Cancel an order | Yes | Yes | Yes | Yes |
| Write order tables directly | No | No | No | No |

RLS grants authenticated active members select-only access to orders, order items and order events.
Direct insert/update/delete is denied for every client role. All writes go through security-definer
RPCs that re-check authentication and active business membership. `order_counters` is not readable
or writable by clients.

## RPCs

### `search_orders`

Returns order rows with item counts and a filtered total. Supports search text, status, customer,
single order id, created-from/created-to dates, limit/offset, sort field and direction. Search covers
order number and the captured customer or guest name, phone and email. Limit is clamped to 1-100 and
a reversed date range is rejected.

### `search_order_catalogue`

Returns active catalogue units for the order editor. Variant products return one row per active
variant; products without variants return one product-level row. Each row includes the effective
unit price, tracking state, available quantity and stock status.

### `get_order_overview`

Returns total orders, per-status counts, open value, completed value and orders created today.

### `create_order`

Requires an active business role, either a same-business customer or a guest name, and at least one
valid item. Prices are resolved from the catalogue; client price fields are rejected. Creates the
order number, customer or guest snapshots, item rows and the initial activity event atomically.

### `update_order`

Edits a draft or awaiting order only. Replaces the item list, reprices from the current catalogue,
refreshes customer or guest snapshots and notes, recalculates totals and appends an activity event.

### `update_order_status`

Moves an order to the next allowed status. Customer confirmation moves the order to business
approval; business approval reserves stock; fulfilment consumes reserved stock. Approval and
fulfilment are restricted to owner, admin and manager roles. Writes the relevant activity events.

### `cancel_order`

Cancels any order that is not completed or already cancelled. Requires a 3-500 character reason,
releases reserved stock and appends a cancellation event.

## UI routes

| Route | Purpose |
| --- | --- |
| `/orders` | Searchable, filterable, sortable, paginated order list with live metrics. |
| `/orders/new` | Create an order; supports `?customerId=` from a customer page. |
| `/orders/:orderId` | Order header, items, totals, customer card, activity and status actions. |
| `/orders/:orderId/edit` | Edit a draft or awaiting order. |

Customer detail pages now show the five most recent orders and link to the order detail page.

## UI rules

- The Orders page shows total, open, fulfilled and today's orders, plus open pipeline value.
- Status and stock-state badges use the shared badge variants; walk-in orders show a `Walk-in` badge.
- The directory supports search, status, created-from and created-to date filters.
- The editor supports catalogue search, variant selection, quantity controls, live catalogue-price
  previews and a linked-customer/walk-in toggle.
- Prices are read-only in the editor; totals shown are a preview and the server recalculates them.
- Editing is blocked once stock is reserved; the detail page offers cancellation instead.
- Status actions are limited to the next legal step and to the current role, so staff do not see
  business-approval or fulfilment actions.
- Cancellation requires a written reason and explains that reserved stock will be released.
- Loading, empty, error and success states are handled on every page.

## Tests

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:orders
```

The suite runs 232 checks against the linked project and cleans up its test users, businesses,
customers, products, orders and inventory. It covers:

- Anonymous and cross-business denial for table reads and every order RPC.
- Role permissions for owner, manager, staff and a non-member, including approval/fulfilment limits.
- Order numbering, per-business sequences and concurrent order creation.
- Customer, guest and catalogue snapshots surviving later renames and price changes.
- Server-authoritative pricing, automatic totals and variant handling.
- Rejection of client-supplied `unit_price` and `line_total` values.
- Walk-in orders with no customer record, guest updates and guest-name search.
- Validation for empty orders, missing customer/guest contact, invalid customers/products, archived
  products, duplicate items, missing variants, zero quantities, notes and cancellation reasons.
- Customer confirmation, business approval, every legal and illegal status transition, and fulfilment.
- Reservation, cancellation release and completion consumption against real inventory balances.
- Immutable activity history, stock events and direct-write denial on every order table.
- Search, status/customer/date filters, sorting, pagination and overview metrics.
- Cleanup of orders, items, events, counters and test users.

## Verification

Day 7 was verified with:

```powershell
npm run test:orders
npm run lint
npm run build
```

Post-migration verification: Day 7 **232/232**, Day 3 **49 passed + 3 skipped**, Day 4 **60/60**,
Day 5 **96/96**, Day 6 **219/219**, `npm run lint` clean and `npm run build` successful (existing
>500 kB chunk warning only).

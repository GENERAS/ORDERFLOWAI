# Day 7 - Order management

## Scope

Day 7 turns the Orders placeholder into a working multi-tenant order module. It adds:

- Draft orders linked to a real customer in the same business.
- Catalogue items with quantity, an optional agreed unit price and preserved snapshots.
- Sequential per-business order numbers (`ORD-00001`, `ORD-00002`, ...).
- A strict order lifecycle from draft to completion, with cancellation.
- Automatic stock reservation, release and consumption through the Day 5 ledger.
- Immutable order activity history for creation, edits, status changes and cancellation.
- Server-side order search, status filtering, sorting and pagination.
- Order list metrics, a create/edit editor, an order detail page and a cancellation dialog.
- Real recent-order history on customer detail pages.

Day 7 does not add payments, invoices, fulfilment integrations or AI order extraction. Those remain
later phases.

## Migration

| Migration | Purpose |
| --- | --- |
| `20261117010000_day7_order_management.sql` | Order tables, counters, constraints, indexes, RLS, stock integration and RPCs. |

The migration has been applied to the linked Supabase project.

## Data model

| Table | Purpose |
| --- | --- |
| `order_counters` | Per-business sequence used to generate order numbers. |
| `orders` | Order header, customer snapshots, status, totals and lifecycle dates. |
| `order_items` | Ordered units with agreed prices and catalogue snapshots. |
| `order_events` | Append-only activity history for each order. |

### `orders`

- `business_id`, `order_number`, required `customer_id`, `status`, `stock_state`, `currency`.
- `customer_name_snapshot`, `customer_phone_snapshot` and `customer_email_snapshot` preserve the
  customer details used when the order was created or last edited.
- `subtotal` and `total` are recalculated by a trigger from `order_items.line_total`.
- `notes` are optional and limited to 2,000 characters.
- `cancellation_reason` is required for cancelled orders and limited to 500 characters.
- `confirmed_at`, `completed_at` and `cancelled_at` record lifecycle milestones.
- `created_by` and `updated_by` reference the acting auth user.
- A composite foreign key ensures the customer belongs to the same business.
- `(business_id, order_number)` is unique.

### `order_items`

- `product_id` and optional `variant_id`, both scoped to the same business and product.
- `product_name_snapshot`, `variant_name_snapshot` and `sku_snapshot` preserve catalogue details.
- `unit_price` is the agreed price. When omitted, the product or variant catalogue price is copied.
- `quantity` is between 1 and 100,000.
- `line_total` is generated as `quantity * unit_price`.
- `reserved_quantity` tracks how much of the line currently holds stock.
- A unique index prevents the same product/variant pair appearing twice in one order.

### `order_events`

- Event types: `created`, `updated`, `status_changed`, `cancelled`.
- Each event stores a human-readable summary, structured details, actor id and actor name snapshot.
- Updates are blocked by a database trigger; the browser has no write grant.
- Deletion is not exposed to clients. Rows cascade with their order or business so test and tenant
  cleanup remain possible.

## Order lifecycle

```text
draft -> awaiting_confirmation -> confirmed -> processing -> ready -> completed
   \___________________________/          |
                |                         |
             cancelled <------------------+
```

- Only `draft` and `awaiting_confirmation` orders can be edited.
- Status changes use `update_order_status` and must follow the next allowed step. Statuses cannot be
  skipped or repeated.
- Cancellation uses `cancel_order` with a reason. Completed and already-cancelled orders cannot be
  cancelled.
- Confirmation records `confirmed_at`; completion records `completed_at`; cancellation records
  `cancelled_at` and the reason.

## Stock rules

| Order event | Stock behaviour | `stock_state` |
| --- | --- | --- |
| Created or edited before confirmation | No stock movement. | `none` |
| Confirmed | Reserve each tracked line through the Day 5 ledger. | `reserved` |
| Cancelled while reserved | Release all reserved units. | `released` |
| Completed while reserved | Release the reservation, then reduce physical stock. | `consumed` |
| Cancelled before confirmation | No stock movement. | remains `none` |

- Untracked catalogue units are ordered without stock movements.
- Reservations are rejected if available inventory is insufficient, so an order cannot be confirmed
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
| Change status and cancel | Yes | Yes | Yes | Yes |
| Write order tables directly | No | No | No | No |

RLS grants authenticated active members select-only access to orders, order items and order events.
Direct insert/update/delete is denied for every client role. All writes go through security-definer
RPCs that re-check authentication and active business membership. `order_counters` is not readable
or writable by clients.

## RPCs

### `search_orders`

Returns order rows with item counts and a filtered total. Supports search text, status, customer,
single order id, limit/offset, sort field and direction. Search covers order number, customer name,
phone and email. Limit is clamped to 1-100.

### `search_order_catalogue`

Returns active catalogue units for the order editor. Variant products return one row per active
variant; products without variants return one product-level row. Each row includes the effective
unit price, tracking state, available quantity and stock status.

### `get_order_overview`

Returns total orders, per-status counts, open value, completed value and orders created today.

### `create_order`

Requires an active business role, a customer in the same business and at least one valid item.
Creates the order number, customer snapshots, item rows and the initial activity event atomically.

### `update_order`

Edits a draft or awaiting order only. Replaces the item list, refreshes customer snapshots and notes,
recalculates totals and appends an activity event.

### `update_order_status`

Moves an order to the next allowed status. Confirmation reserves stock; completion consumes
reserved stock. Writes an activity event with the previous and next status.

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

- The Orders page shows total, open, completed and today's orders, plus open pipeline value.
- Status and stock-state badges use the shared badge variants.
- The editor supports catalogue search, variant selection, agreed prices, quantity controls and
  live totals.
- Editing is blocked for confirmed orders; the detail page offers cancellation instead.
- Status actions are limited to the next legal step, so the UI mirrors the database state machine.
- Cancellation requires a written reason and explains that reserved stock will be released.
- Loading, empty, error and success states are handled on every page.

## Tests

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:orders
```

The suite runs 201 checks against the linked project and cleans up its test users, businesses,
customers, products, orders and inventory. It covers:

- Anonymous and cross-business denial for table reads and every order RPC.
- Role permissions for owner, manager, staff and a non-member.
- Order numbering, per-business sequences and concurrent order creation.
- Customer and catalogue snapshots surviving later renames and price changes.
- Agreed prices, automatic totals and variant handling.
- Validation for empty orders, invalid customers/products, archived products, duplicate items,
  missing variants, zero quantities, notes and cancellation reasons.
- Every legal and illegal status transition.
- Reservation, cancellation release and completion consumption against real inventory balances.
- Immutable activity history and direct-write denial on every order table.
- Search, status/customer filters, sorting, pagination and overview metrics.
- Cleanup of orders, items, events, counters and test users.

## Verification

Day 7 was verified with:

```powershell
npm run test:orders
npm run lint
npm run build
```

The Day 2-6 regression suites were also run after the migration.

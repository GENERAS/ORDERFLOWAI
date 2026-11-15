# Day 5 — Inventory management

## Scope

Day 5 turns the Inventory placeholder into a real multi-tenant stock module. It adds:

- Inventory balances for tracked products and variants.
- Generated available quantities and low-stock/out-of-stock calculations.
- An immutable, append-only stock movement ledger.
- Atomic stock operations for receipts, reductions, adjustments, damage, loss, returns,
  reservations and releases.
- Row locking and idempotency keys that prevent duplicate movements and concurrent overselling.
- Inventory search, overview metrics, item detail, movement history and tracking controls.
- Inventory, concurrency and RLS integration tests.

Day 5 does **not** add orders, payments, purchasing, suppliers or AI workflows. Order-driven
reservations remain later-phase work; the reservation primitives are ready for that integration.

## Migrations

| Migration | Purpose |
| --- | --- |
| `20261115010000_day5_inventory_management.sql` | Inventory tables, generated availability, scope guards, immutable ledger, RLS and RPCs. |

The migration has been applied to the linked Supabase project.

## Data model

| Table | Purpose |
| --- | --- |
| `inventory_items` | One balance row per tracked product or variant. |
| `stock_movements` | Append-only audit ledger for every stock operation. |

### `inventory_items`

- `business_id`, `product_id` and optional `variant_id`.
- `is_tracked` controls whether stock operations are allowed.
- `physical_quantity`, `reserved_quantity` and generated stored `available_quantity`.
- Optional `low_stock_threshold`.
- Partial unique indexes enforce one product-level row and one row per variant.
- Checks require nonnegative quantities, `reserved <= physical`, and zero quantities while
  tracking is disabled.

### `stock_movements`

- Business, product, variant and inventory-item references.
- Signed `quantity_change`, operation type and optional reason.
- Previous/new physical and reserved balances.
- Product name, variant name and SKU snapshots at movement time.
- Actor ID and display name, idempotency key and timestamp.
- Unique per-business idempotency keys.
- Updates are rejected by an immutability trigger. Rows are removed only when the owning business
  or inventory item is deleted through cascade cleanup.

## Tracking scope

- A product without variants uses one product-level inventory row.
- A product with variants uses one inventory row per variant; product-level tracking is rejected.
- A product-level inventory row blocks adding variants to that product.
- Disabling tracking requires zero physical and reserved stock.
- If no movement history exists, disabling removes the unused row. If history exists, the row stays
  untracked so the ledger and item references remain intact.
- Re-enabling tracking reuses the existing row and keeps its history.

## Roles and RLS

Every inventory table requires an active membership in the business.

| Action | Owner | Admin | Manager | Staff |
| --- | --- | --- | --- | --- |
| Read inventory and movement history | Yes | Yes | Yes | Yes |
| Record stock operations | Yes | Yes | Yes | Yes |
| Enable/disable tracking | Yes | Yes | Yes | No |
| Change low-stock thresholds | Yes | Yes | Yes | No |
| Write balances or movements directly | No | No | No | No |

RLS grants authenticated members select-only access. Direct insert/update/delete is denied for all
roles; writes go through security-definer RPCs that re-check active membership and role. Trigger
functions are revoked from client roles.

## Stock operations

| Operation | Signed change | Affects | Reason |
| --- | --- | --- | --- |
| `receive` | Positive | Physical | Optional |
| `reduce` | Negative | Physical | Optional |
| `adjustment` | Positive or negative | Physical | Required |
| `damage` | Negative | Physical | Required |
| `loss` | Negative | Physical | Required |
| `return` | Positive | Physical | Optional |
| `reserve` | Positive | Reserved | Optional |
| `release` | Negative | Reserved | Optional |

Rules:

- Quantities are whole units and cannot be zero.
- Physical stock cannot drop below zero or below reserved stock.
- Reservations cannot exceed available stock.
- `reserve` and `release` never change the physical balance.
- Each operation updates the balance and inserts exactly one movement in the same transaction.
- A per-business idempotency key returns the original movement for an identical retry. Reusing a
  key for a different operation or item raises a uniqueness error.
- Item row locks plus an advisory lock make concurrent reservations and duplicate submissions safe.

## RPCs

### `search_inventory`

Returns one row per product unit with product/variant names, SKU/barcode, category, statuses,
balances, threshold, computed inventory status and total count. Supports search, status, category,
inventory-item and pagination parameters plus bounded sort direction.

### `get_inventory_overview`

Returns total catalogue units, tracked/untracked counts, in-stock/low-stock/out-of-stock counts,
physical/reserved/available totals, movement count, movements today and the last movement time.

### `list_stock_movements`

Returns a paginated, newest-first ledger with search across item, SKU, reason and actor, plus an
operation filter and optional inventory-item filter.

### `enable_inventory_tracking`

Creates or re-enables a product-level or variant-level inventory row. Requires owner, admin or
manager. Rejects product-level tracking for variant products.

### `disable_inventory_tracking`

Requires owner, admin or manager and zero physical/reserved stock. Removes an unused row or marks a
row with history as untracked.

### `update_inventory_threshold`

Requires owner, admin or manager. Accepts a nonnegative integer or `null` to remove the threshold.

### `record_stock_operation`

Requires any active member. Validates the operation, signed quantity, reason, tracking state and
reservation rules; locks the item; updates balances and appends the movement atomically.

## UI routes

| Route | Purpose |
| --- | --- |
| `/inventory` | Overview metrics, inventory search/filter/pagination and tracking controls. |
| `/inventory/items/:inventoryItemId` | Item balances, stock-operation form, threshold editor and recent movements. |
| `/inventory/movements` | Searchable, filterable, paginated immutable ledger. |

The inventory dashboard shows available, tracked, low-stock and out-of-stock metrics. Untracked
units can be enabled by managers through an accessible dialog. The item page separates physical,
reserved, available and threshold quantities, confirms every operation, keeps the idempotency key
stable for retries, and displays the latest ledger entries.

## Services and helpers

- `src/services/inventoryService.js` owns inventory search, metrics, movement history, tracking
  settings and stock-operation RPC calls.
- `src/features/inventory/inventoryUtils.js` owns status/operation labels, role checks, sorting
  options, quantity formatting and signed-change helpers.
- `InventoryServiceError` normalizes RLS, uniqueness, validation and missing-record errors.
- `src/features/inventory/components/` contains the enable-tracking dialog, threshold editor and
  stock-operation form.

Components do not issue raw inventory queries or direct balance writes.

## Integration tests

Run:

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:inventory
```

The script is `scripts/day5-inventory-tests.mjs`. It uses the publishable key for real Auth and
PostgREST calls, and direct PostgreSQL access only for setup and cleanup. No service-role key is
used.

Covered cases (96 checks):

1. Anonymous inventory, movement and RPC access is denied.
2. Search returns one row per product or variant with correct totals.
3. New catalogue units start untracked; overview metrics start at zero.
4. Category filters, pagination and name/availability sorting.
5. Direct balance inserts and updates are denied.
6. Staff cannot enable tracking or change thresholds; managers can.
7. Every stock operation updates the expected balance.
8. Reservations cannot exceed availability; fully reserved stock is out of stock.
9. Physical stock cannot drop below zero or reserved stock.
10. Adjustments, damage and loss require a reason.
11. Duplicate idempotent requests return one movement and apply quantity once.
12. Reusing an idempotency key for another operation is rejected.
13. Low-stock status respects the configured threshold.
14. Movement snapshots preserve product names after catalogue edits.
15. Tracking cannot be disabled while stock remains.
16. Unused tracking rows are deleted; rows with history remain untracked.
17. Product-level tracking is rejected for variant products and blocks adding variants.
18. Variant rows keep independent balances and reservation limits.
19. Concurrent duplicate requests resolve to one movement.
20. Concurrent reservations cannot oversell; one succeeds and one fails.
21. Other businesses cannot read or change inventory or movement history.
22. Direct movement updates are denied.
23. Movement operation filters, item filters, pagination and totals.
24. Final overview metrics match all balances.
25. The suite removes its test users, businesses, inventory rows and movements.

## Manual verification checklist

- [ ] Open `/inventory` with an untracked catalogue and see the metrics and empty stock.
- [ ] Enable tracking for a simple product as manager; confirm staff cannot.
- [ ] Receive opening stock and confirm physical/available values update.
- [ ] Reserve stock; confirm reserved rises and available falls without changing physical.
- [ ] Try over-reserving and confirm the operation is rejected.
- [ ] Record damage/loss with a reason and an adjustment in both directions.
- [ ] Set a threshold and confirm low-stock filtering and overview counts.
- [ ] Enable tracking for each variant of a variant product and receive stock separately.
- [ ] Confirm a product-level inventory row blocks adding variants.
- [ ] Disable tracking only after reducing physical and reserved stock to zero.
- [ ] Open `/inventory/movements` and filter by search, operation and item.
- [ ] Confirm a second workspace cannot see the first workspace inventory.

## Known limitations

- No automated browser test runner is installed; UI behaviour is verified by lint/build, the
  integration suite and manual checks.
- Docker is unavailable in this environment. `supabase db push` succeeds but may print warnings
  about failing to cache the migration catalog through Docker.
- Stock quantities are integer units; fractional quantities are not supported.
- Thresholds are optional and simple; there are no per-location thresholds or supplier reorder
  points yet.
- Inventory search uses bounded `ilike` matching because `pg_trgm` is unavailable.
- Orders and payments are not implemented, so reservations are currently created manually rather
  than automatically during order confirmation.
- The ledger is append-only for application users; there is no reversal/void workflow yet. A wrong
  movement is corrected with an explicit adjustment and reason.

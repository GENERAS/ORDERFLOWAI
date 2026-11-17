# Day 9 — Public multi-tenant storefront

Day 9 adds a real public storefront per business. Customers can browse a published catalogue, open
product details, add items to a local cart, and submit a real order without signing in. The
storefront reuses the Day 4 catalogue, Day 5 inventory ledger, Day 6 customer matching rules, Day 7
order engine and Day 8 payment status reporting. No duplicate order schema was introduced.

## Files

- `supabase/migrations/20261121010000_day9_public_storefront.sql`
- `supabase/migrations/20261121020000_day9_storefront_stock_reservation_fix.sql`
- `src/features/storefront/storefrontService.js`
- `src/features/storefront/storefrontUtils.js`
- `src/features/storefront/StorefrontContext.jsx`
- `src/features/storefront/StorefrontLayout.jsx`
- `src/features/storefront/PublicStorefrontPage.jsx`
- `src/features/storefront/StorefrontProductPage.jsx`
- `src/features/storefront/StorefrontCheckoutPage.jsx`
- `src/features/storefront/StoreManagementPage.jsx`
- `src/features/storefront/components/StoreProductCard.jsx`
- `src/App.jsx`
- `src/config/navigation.js`
- `src/features/settings/SettingsPage.jsx`
- `scripts/day9-storefront-tests.mjs`

## Routes

| Route | Access | Purpose |
| --- | --- | --- |
| `/store/:storeSlug` | Public | Store profile, search, category filter, sort and paginated catalogue. |
| `/store/:storeSlug/products/:productId` | Public | Product images, variants, availability and add-to-cart. |
| `/store/:storeSlug/checkout` | Public | Customer details, server-priced order summary and order submission. |
| `/store` | Active workspace member | Store profile, published contact details, logo and product visibility. |

`vercel.json` already rewrites unknown paths to `index.html`, so direct links to public store URLs
work on the static Vercel deployment.

## Architecture reused

- Catalogue: `products`, `product_variants`, `categories`, `brands`, `product_images`.
- Inventory: `inventory_items`, `available_quantity`, `record_stock_operation` ledger rules.
- Customers: `normalize_customer_phone_digits`, exact email and phone matching only.
- Orders: `next_order_number`, `create_order_item_record`, `orders`, `order_items`, `order_events`,
  `awaiting_business_approval`, `stock_state`.
- Payments: `get_order_payment_summary`; checkout records no payment and leaves status `pending`.
- Storage: private `product-images` bucket and new private `store-logos` bucket with anon signed URLs.

## Data model

### Stores

Each business has exactly one `public.stores` row. It is created automatically by
`auto_create_business_store` when a business is created; existing businesses were backfilled by the
first Day 9 migration. Slugs are unique and validated as lowercase alphanumeric hyphen strings.
`unique_store_slug` adds a stable suffix when a business slug would collide.

A store is `active` or `inactive`. Public reads, catalogue reads and checkout all reject inactive
stores. Logo paths must use `${businessId}/${uuid}.${ext}` and are validated by a trigger.

### Product visibility

`products.storefront_visible` defaults to `false`. Publishing is explicit. Public catalogue RPCs
only return products that are:

- in the active store's business;
- `active`, not `draft` or `archived`;
- marked `storefront_visible`;
- backed by at least one active unit (simple product or active variant).

### Idempotency

`storefront_order_requests` stores one response per `(business_id, idempotency_key)`. A repeated key
with the same request hash returns the original response. A repeated key with different details is
rejected. The RPC takes an advisory transaction lock before checking the key.

## RPCs

| RPC | Purpose |
| --- | --- |
| `get_store_profile` | Private store profile for active business members. |
| `get_public_store` | Public active-store profile with contact fields hidden unless published. |
| `update_store_profile` | Owner/admin/manager store profile update with validation. |
| `set_storefront_product_visibility` | Owner/admin/manager/staff product publish toggle. |
| `search_storefront_management_products` | Member catalogue search for the management page. |
| `list_storefront_categories` | Public categories with only published active products. |
| `search_storefront_products` | Public catalogue with search, category, sort and pagination. |
| `get_storefront_product` | Public product detail with variants and image paths. |
| `submit_storefront_order` | Public order submission with server pricing and stock reservation. |
| `reserve_storefront_order_stock` | Internal locked reservation path for anonymous checkout. |

## Checkout

`submit_storefront_order` validates the store, customer details, item shape, product/variant scope,
visibility and active status. Client prices are rejected. Prices and currency come from the shared
catalogue and business. The RPC:

1. optionally links an existing customer only when both email and normalized phone exactly match one
   customer in the business;
2. creates an order in `awaiting_business_approval` with delivery details in `orders.notes`;
3. creates order items through `create_order_item_record`;
4. reserves tracked stock through `reserve_storefront_order_stock`;
5. logs a `customer_confirmed` event with actor name `Online storefront`;
6. stores an idempotent response for the checkout key.

No payment gateway is called and no payment row is created. The order remains unpaid and awaiting
business review. Business staff handle payment arrangements later through the Day 8 payment module.

## Stock reservation fix

The first Day 9 migration used `FOR UPDATE OF inv` on a `LEFT JOIN` inventory item. PostgreSQL
rejects locking a nullable outer-join side, so checkout failed with `0A000`. The corrective migration
locks matching `inventory_items` rows in a separate pass before reading the joined order-item view.
This keeps the reservation locked and prevents overselling without locking a nullable join.

## Roles

| Action | Allowed |
| --- | --- |
| Browse public store and submit order | anonymous |
| Read private store profile | active business members |
| Update store profile | owner, admin, manager |
| Toggle product visibility | owner, admin, manager, staff |
| Search management catalogue | active business members |
| Call internal stock reservation RPC | server-side only |

## Security and performance

- Public users cannot select from `stores`, `storefront_order_requests`, `products`, `orders` or
  internal management RPCs directly.
- All public reads go through scoped security-definer RPCs.
- Image URL generation uses anon signed URLs granted only when the image belongs to a published,
  active product in an active store, or to an active store logo.
- Checkout uses per-store idempotency, advisory locks, row locks and unique constraints.
- Public queries use bounded limits, partial indexes and store/status/slug indexes.
- No service-role key, database password or provider secret is read by the browser.
- No fake payments, fake products, fake sessions or separate storefront order records were added.

## Migration notes

Apply both migrations manually and load the database password first:

```powershell
. .\scripts\load-supabase-db-password.ps1
node scripts/db-query.mjs supabase/migrations/20261121010000_day9_public_storefront.sql
node scripts/db-query.mjs supabase/migrations/20261121020000_day9_storefront_stock_reservation_fix.sql
```

Migrations in this project are applied manually and are not recorded in
`supabase_migrations.schema_migrations`.

## Tests

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:storefront
```

The 110-check suite covers:

- automatic store creation, unique slugs and store backfill;
- private profile access, cross-tenant denial and anonymous denial;
- store profile validation, contact visibility, slug conflicts and logo-path validation;
- role checks for profile updates and product visibility;
- public catalogue search, category filters, sorting, detail and hidden/draft isolation;
- signed image and logo URL access tied to active/public state;
- invalid checkout input, client-price rejection, hidden/draft/out-of-stock denial and variant rules;
- real order creation, server prices, delivery notes, reserved stock and immutable movement ledger;
- event logging, pending payment status, idempotent retry and conflicting idempotency keys;
- conservative customer linking by exact email and normalized phone;
- shared order visibility for business users and anonymous order-table denial;
- internal reservation RPC denial to anon;
- inactive-store blocking and reactivation.

Lint, production build and all Day 3–Day 9 integration suites pass after applying both Day 9
migrations.

## Unresolved deployment issue

The reported production login message `We could not reach the server. Check your connection and try
again.` comes from `src/services/authService.js`. It is triggered by network/fetch failures, status
`0`, or `AuthRetryableFetchError`. No repo code change was made for it because the likely cause is
deployment configuration: stale or missing `VITE_SUPABASE_URL`, stale or missing
`VITE_SUPABASE_ANON_KEY`, Supabase project reachability, or browser/CORS/network failure. Verify the
Vercel environment values and Supabase Auth allow list after deployment.

## Day 10 dependencies

- Storefront URLs should be included in deployment smoke tests.
- Public order review and fulfilment should use the existing Orders module; no separate storefront
  order screen is needed.
- Payment collection remains handled by the existing Day 8 payment module or a future provider
  integration.
- AI discovery and conversation ordering still require backend Edge Functions and are intentionally
  deferred.

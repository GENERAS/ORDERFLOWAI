# Day 4 — Product catalogue

## Scope

Day 4 turns the placeholder Products module into a real multi-tenant catalogue. It adds:

- Catalogue tables, constraints, indexes, triggers and Row Level Security.
- Atomic RPCs for product creation/update and attribute creation.
- Server-side product search with filters, pagination and primary-image metadata.
- Product editor with pricing, status, reusable attributes, variants and photos.
- Category, brand and attribute management pages.
- Private Supabase Storage for product images.
- Catalogue, storage and RLS integration tests.

Day 4 does **not** add inventory quantities, stock movements, orders, payments or AI workflows.

## Migrations

| Migration | Purpose |
| --- | --- |
| `20261114010000_day4_product_catalogue.sql` | Catalogue schema, triggers, RLS, storage bucket, storage policies and RPCs. |
| `20261114020000_fix_day4_update_product.sql` | Fixes an ambiguous PL/pgSQL variable in `update_product`. |

Both migrations have been applied to the linked Supabase project.

## Data model

| Table | Purpose |
| --- | --- |
| `categories` | Same-business category hierarchy with optional parent. |
| `brands` | Business-owned brand names and descriptions. |
| `products` | Product details, pricing, status, SKU/barcode and currency. |
| `product_variants` | Optional product options with their own SKU, barcode and price override. |
| `product_attributes` | Reusable text, number, boolean or select attributes. |
| `product_attribute_options` | Selectable values for select attributes. |
| `product_attribute_values` | Product-level or variant-level attribute values. |
| `product_images` | Private storage paths, alt text, ordering and primary-image flag. |

Key invariants:

- All catalogue rows belong to exactly one business and cannot move between businesses.
- Products support `draft`, `active` and `archived`; variants support `active` and `inactive`.
- Products are archived rather than hard-deleted. There is no product DELETE grant or policy.
- Removing a saved variant from `update_product` keeps the row and marks it inactive.
- Category parents must belong to the same business, and cycles are rejected.
- SKUs and barcodes are unique per business across **both** products and variants. Advisory locks
  plus triggers enforce this across the two tables.
- Product currency must match the business currency.
- Select attribute values must use an option belonging to the same attribute.
- Images must use the path `${businessId}/${productId}/${uuid}.${ext}`.

## Roles and RLS

Every catalogue table requires an active membership in the business.

| Action | Owner | Admin | Manager | Staff |
| --- | --- | --- | --- | --- |
| Read catalogue | Yes | Yes | Yes | Yes |
| Create/update products | Yes | Yes | Yes | Yes |
| Create/update variants | Yes | Yes | Yes | Yes |
| Add/update/delete attribute values | Yes | Yes | Yes | Yes |
| Upload/update/delete product images | Yes | Yes | Yes | Yes |
| Manage categories | Yes | Yes | Yes | No |
| Manage brands | Yes | Yes | Yes | No |
| Manage attribute definitions and options | Yes | Yes | Yes | No |

RLS is the authorization boundary. The UI hides taxonomy actions for staff, but direct API calls
are also denied by the policies.

## RPCs

### `create_product`

Creates a product, product-level attribute values, variants and variant attribute values in one
transaction. It validates membership, name, price, status, variant names and attribute values.

### `update_product`

Updates product details, replaces product-level attribute values, updates/creates submitted
variants, and marks saved variants omitted from the payload as inactive. The follow-up migration
renames the internal variant-id variable so it no longer collides with the `variant_id` column.

### `create_product_attribute`

Creates an owner/admin/manager-visible attribute and its select options atomically. Staff calls
are rejected with `42501`.

### `search_products`

Returns a filtered page of products with category name, brand name, active-variant count, primary
image path/alt text and total result count. Search is case-insensitive and bounded to 100 rows per
request. Category/brand/status filters are optional.

Taxonomy lists use direct RLS-protected queries through `catalogueService`; no separate
`list_categories` or `list_brands` RPC is implemented.

## Storage

The `product-images` bucket is private with:

- 5 MB file-size limit.
- Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`, `image/avif`.
- Business-scoped select/insert/update/delete policies for active members.
- Signed URL expiry of one hour in the browser.

The database validates the storage path prefix and rejects path traversal. Deleting an image row
also removes the storage object through the service layer.

Brand logo uploads are **not** implemented in Day 4; brands have a name and description only.

## UI routes

| Route | Purpose |
| --- | --- |
| `/products` | Search, filter, paginate, preview and archive products. |
| `/products/new` | Create a product, attributes and variants. |
| `/products/:productId/edit` | Edit an existing product, variants and photos. |
| `/products/categories` | Manage the category hierarchy. |
| `/products/brands` | Manage brands. |
| `/products/attributes` | Manage reusable product and variant attributes. |

The product editor loads categories, brands and attributes in parallel with the product. It shows
product-level and variant-level attributes separately, validates names/prices client-side, and
reloads the product after saving so new variant IDs are available for subsequent edits.

The image manager supports multi-file upload, alt text, primary-image selection, ordering and
deletion. Product thumbnails use short-lived signed URLs.

## Services and helpers

- `src/services/catalogueService.js` owns all catalogue and image-storage access.
- `src/features/products/catalogueUtils.js` owns status options, role checks, category flattening,
  attribute-value labelling and value mapping.
- `CatalogueServiceError` normalizes PostgREST, RLS, validation, uniqueness and storage-size errors.

Components do not issue raw catalogue queries.

## Integration tests

Run:

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:catalogue
```

The script is `scripts/day4-catalogue-tests.mjs`. It uses the publishable key for real Auth and
PostgREST/storage calls, and direct PostgreSQL access only for setup and cleanup. No service-role
key is used.

Covered cases (60 checks):

1. Bucket is private with the expected size and MIME limits.
2. Anonymous catalogue reads are denied.
3. Owner and manager can manage taxonomy; staff cannot.
4. Category hierarchy creation and cycle rejection.
5. Attribute creation with options and variant/required metadata.
6. Staff can create, update and archive products, variants and attribute values.
7. Product currency, SKU normalization and validation errors.
8. Search filters, total counts, active-variant counts and server-side pagination.
9. Removed variants are kept but marked inactive.
10. Product and cross-table variant SKU conflicts.
11. Archived products are filterable and can be restored.
12. Product hard-delete is denied.
13. Cross-tenant search, product creation and category reads are denied.
14. Categories/brands in use cannot be deleted.
15. Private image upload, image rows, primary-image search metadata and signed URLs.
16. Cross-business and cross-tenant uploads are denied.
17. Unsupported MIME types and invalid image paths are rejected.
18. Image rows can be deleted.

The suite creates unique `day4-test-*` users and `day4-*` workspaces, then removes its database
rows and uploaded storage objects in a `finally` block.

## Manual verification checklist

- [ ] Open `/products` with an empty catalogue and see the empty state.
- [ ] Create a category, brand and attributes as owner/manager.
- [ ] Sign in as staff and confirm taxonomy actions are hidden and denied.
- [ ] Create a product with product-level and variant attributes.
- [ ] Search by name, SKU and barcode; filter by category, brand and status.
- [ ] Edit the product, remove a variant and confirm it becomes inactive.
- [ ] Upload multiple images, set a primary image, reorder and delete one.
- [ ] Archive a product and confirm it can still be found with the archived filter.
- [ ] Confirm signed image URLs load while the bucket remains private.
- [ ] Confirm a second workspace cannot see the first workspace catalogue.

## Known limitations

- No automated browser test runner is installed; UI behaviour is verified by lint/build, the
  integration suite and manual checks.
- Docker is unavailable in this environment. `supabase db push` succeeds but may print warnings
  about failing to cache the migration catalog through Docker.
- Catalogue taxonomy lists are not paginated. This is acceptable for the expected small number of
  categories, brands and attributes per workspace.
- `pg_trgm` is unavailable, so product search uses bounded `ilike` matching rather than fuzzy
  ranking.
- Image transformations, visual search and brand logos remain later-phase work.
- Inventory, orders, payments and AI workflows remain intentionally out of scope.

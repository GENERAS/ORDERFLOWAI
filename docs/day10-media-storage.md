# Day 10 — Media storage and asset management

Day 10 adds one provider-independent media layer for product photos and store logos. Existing Day 4
product images and Day 9 store logos keep their private Supabase Storage paths, signed URLs and
public eligibility rules. New uploads are tracked as `media_assets` rows and referenced from
`product_images.media_asset_id` or `stores.logo_media_asset_id`.

The active provider stays in `public.media_provider_config`. The current project uses `supabase`.
A Cloudinary adapter is implemented, but Cloudinary is only usable after secrets are configured and
the Edge Function is deployed. No Cloudinary live upload or delete has been claimed or tested.

## Migrations

- `supabase/migrations/20261122010000_day10_media_storage.sql`
- `supabase/migrations/20261122020000_day10_media_url_resolver.sql`
- `supabase/migrations/20261122030000_day10_media_filename_check_fix.sql`

All three are applied to the linked Supabase project. They are not recorded in
`supabase_migrations.schema_migrations`; the local `node scripts/db-query.mjs <path>` workflow was
used.

The third migration fixes two PostgreSQL-invalid `chr(0)` checks from the first migration. PostgreSQL
text cannot contain NUL bytes, so filename validation now uses a safe control-character regex in both
the `media_assets` constraint and `media_start_upload`.

## Schema

| Object | Purpose |
| --- | --- |
| `public.platform_admins` | Users allowed to change provider/limit configuration. |
| `public.media_provider_config` | Singleton provider, cloud name, max file size and MIME allow list. |
| `public.media_upload_limits` | Optional per-business file count and byte limits. |
| `public.media_assets` | Upload lifecycle, provider reference, metadata, status and delivery URL. |
| `public.product_images.media_asset_id` | Links a product image to a tracked asset. |
| `public.stores.logo_media_asset_id` | Links a store logo to a tracked asset. |

`media_assets` is select-only for active members of the owning business. There are no direct client
insert/update/delete policies. Every state change goes through a security-definer RPC.

## RPCs

- `media_get_provider_config`: authenticated read of the active provider and limits.
- `set_media_provider_config`: platform-admin provider configuration.
- `set_business_media_limits`: platform-admin per-business limits.
- `media_start_upload`: validates role, file, provider and limits; idempotent by client request ID.
- `media_get_upload_authorization`: authorizes Edge Function signing/completion.
- `media_complete_upload`: marks a pending asset ready after the provider confirms the file.
- `media_fail_upload`: records a failed upload.
- `media_mark_deleted`: marks an unreferenced asset deleted.
- `media_attach_product_image`: attaches a ready product image and keeps primary/ordering rules.
- `get_business_media_usage`: ready/pending/failed counts and configured limits.
- `media_list_abandoned`: lists stale pending uploads for cleanup.
- `media_resolve_image_url` / `media_resolve_image_urls`: resolves Cloudinary references; Supabase paths
  remain signed by the client.

`validate_product_image_path` and `validate_store_logo_path` keep the legacy path format and also
accept `cloudinary:<public_id>` only when the linked asset is ready, owned by the same business and of
the matching category.

## Client layer

- `src/services/mediaStorageManager.js`: central upload, URL, metadata, list, usage, delete and cleanup API.
- `src/services/media/supabaseStorageAdapter.js`: signed upload URL, signed delivery URL and object removal.
- `src/services/media/cloudinaryAdapter.js`: Edge Function signed upload, optimized delivery URL and delete.
- `src/services/media/resolveMediaUrls.js`: resolves Cloudinary URLs and falls back to Supabase signed URLs.
- `src/services/media/mediaErrors.js`: normalized media errors and byte formatting.

`catalogueService` and `storefrontService` use this layer. Product images now support replace with
upload progress. Store logos support upload progress, removal and live storage usage in store management.
Day 9 public storefront functions now project `logo_url`, `primary_image_url` and image `url` fields while
continuing to sign legacy private paths.

## Cloudinary Edge Function

`supabase/functions/media-manager/index.ts` exposes four actions:

| Action | Purpose |
| --- | --- |
| `cloudinary-sign` | Verify the user and asset, then return short-lived Cloudinary upload fields. |
| `cloudinary-complete` | Verify the resource through Cloudinary's Admin API and complete the DB asset. |
| `cloudinary-delete` | Destroy the Cloudinary resource and mark the DB asset deleted. |
| `cleanup-abandoned` | Remove stale pending uploads from the configured provider. |

The function uses the caller's JWT with the public anon key. It never uses the service-role key.

Required Edge Function secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Only the first two are normally provided by the Supabase runtime for an Edge Function; set all values
in the deployed function's secrets. Do not add any `CLOUDINARY_*` value to `.env.local`, `VITE_*`, or
the browser bundle.

Switching providers requires a platform admin to run `set_media_provider_config` with `supabase` or
`cloudinary`. Cloudinary mode also requires a cloud name in the config plus the three Cloudinary
secrets. If the provider is switched while uploads are pending, those uploads are rejected with a
refresh message instead of being silently moved.

## Tests

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:media
```

The Day 10 suite runs 89 checks against the linked project with no service-role key. It covers provider
config authorization, validation, idempotent upload start, RLS, signed Supabase storage upload,
completion, product/logo attachment, public eligibility, signed URL access, URL resolution, usage,
failed uploads, attached-asset deletion protection, platform-admin limits, logo removal and cleanup.

Lint, production build, Days 4 and 9 regressions, and the Day 10 suite pass. Cloudinary live upload,
verification and deletion remain untested until real credentials and the deployed function are available.

## Current status

- Active provider: `supabase`.
- Legacy Day 4/Day 9 private paths remain supported.
- Cloudinary code and Edge Function are implemented but not connected.
- No fake uploads, fake usage, demo images or mock provider responses are used.

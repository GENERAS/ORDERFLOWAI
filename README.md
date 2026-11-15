# OrderFlow AI

AI-powered product discovery and order automation for businesses. OrderFlow AI connects
customer conversations to a business's real product catalogue, order records, inventory and
payments through a single multi-tenant SaaS workspace.

> **Current status: Day 5 — inventory management.**
> The app now has email/password Supabase Auth, protected routes, multi-workspace onboarding,
> a real product catalogue, and live inventory with physical, reserved and available stock,
> immutable stock movements, low-stock alerts and audited stock operations. Orders, payments
> and AI remain later phases.

## What is included in this build

- React + Vite application with an organised, feature-based architecture.
- Tailwind CSS design system with a restrained brand palette and responsive layouts.
- Responsive SaaS dashboard shell: sidebar, sticky header, content area and mobile drawer.
- Working client-side navigation for all planned modules.
- Dashboard with reusable metric cards, clean empty states and honest "no data" placeholders.
- Centralised Supabase browser client configured from environment variables.
- Email/password registration, email verification, login, logout and password recovery.
- Centralised auth state with profile and active-membership loading, session persistence and
  cross-tab sign-out.
- Protected routing for authenticated users and for users with an active workspace.
- Business onboarding with validated business details and atomic `create_business` creation.
- Multi-workspace selection, workspace switching, and active-workspace persistence.
- Reusable auth forms, accessible form errors, password visibility controls and normalized
  auth/RLS error messages.
- Product catalogue list with server-side search, category/brand/status filters and pagination.
- Product editor for details, pricing, status, reusable attributes, variants and soft archival.
- Category, brand and attribute management with role-aware controls.
- Private product-image uploads with 5 MB limits, signed URLs, alt text and primary-image ordering.
- Catalogue RPCs for atomic product creation/update, attribute creation and catalogue search.
- Live inventory balances for tracked products and variants, with generated available quantities.
- Immutable, append-only stock movements with actor snapshots, reasons and before/after balances.
- Atomic stock operations for receipts, reductions, adjustments, damage, loss, returns, reservations
  and releases, with idempotency and concurrency protection.
- Inventory dashboard with low-stock/out-of-stock filters, overview metrics, tracking controls and
  paginated movement history.
- Reusable paginated data-access layer with normalised errors and a retry helper.
- Shared domain constants and JSDoc types for future features.
- ESLint configuration, auth/catalogue/inventory integration tests and a documented Supabase setup
  workflow.

## Technology stack

| Layer | Technology |
| --- | --- |
| UI | React, Vite |
| Styling | Tailwind CSS |
| Language | JavaScript (ES modules) |
| Auth | Supabase Auth (email/password) |
| Database | Supabase PostgreSQL with Row Level Security |
| Storage | Supabase Storage (private product images) |
| Backend functions | Supabase Edge Functions (AI workflows, later phase) |
| AI | Provider selected in a later phase, called only from backend functions |
| Deployment | Vercel-compatible static build |

Only one database is used: Supabase PostgreSQL. No secondary database or premature
infrastructure (Redis, Kafka, microservices, Kubernetes) is introduced.

## Prerequisites

- Node.js 20.19+ (developed on Node 25)
- npm 10+
- A Supabase project (optional for viewing the shell, required for data features)

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Create your local environment file
#    Copy .env.example to .env.local, then add your Supabase values.
#    On Windows PowerShell:
Copy-Item .env.example .env.local

# 3. Start the development server
npm run dev
```

The app runs at `http://localhost:5173`. After sign-in, `/` redirects to onboarding, the
workspace picker, or `/overview` depending on the user's memberships.

Email confirmation is required on the linked Supabase project. For local development, the
Supabase Auth **Site URL** must be `http://localhost:5173` and the redirect allow list must
include the callback and password-reset pages:

- `http://localhost:5173/auth/callback`
- `http://localhost:5173/reset-password`
- `http://127.0.0.1:5173/auth/callback`
- `http://127.0.0.1:5173/reset-password`

The shell works without Supabase credentials, but a setup notice is displayed and any
data-backed feature will remain unavailable until credentials are added.

## Available scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server with HMR |
| `npm run build` | Create a production build in `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint across the project |
| `npm run test:auth` | Run Day 3 auth, onboarding and RLS integration tests (requires `.env.local` and the DB password) |
| `npm run test:catalogue` | Run Day 4 catalogue, storage and RLS integration tests (requires `.env.local` and the DB password) |
| `npm run test:inventory` | Run Day 5 inventory balance, ledger, concurrency and RLS integration tests (requires `.env.local` and the DB password) |

## Environment variables

Create `.env.local` from `.env.example`. Only variables prefixed with `VITE_` are exposed to
the browser.

| Variable | Required | Description |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Yes (for data) | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes (for data) | Public browser key: legacy anon key or newer publishable key (`sb_publishable_...`) |

The project access token is **not** a frontend variable. It is stored via the Supabase CLI
login (Windows Credential Manager) and is used only for management and migration commands.
`SUPABASE_DB_PASSWORD` is loaded into the shell only for migration and integration-test
scripts; it is never read by the browser bundle.

Auth emails use the project's Site URL and redirect allow list. Configure those in the
Supabase dashboard or with the Management API before testing registration or password
recovery. The linked project currently has email confirmation enabled and uses the built-in
mailer, which is rate-limited to two auth emails per hour.

**Security rules**

- Never place the Supabase service-role key, database password, or AI provider keys in
  `VITE_` variables. They are bundled into the browser.
- `.env`, `.env.local` and other local environment files are ignored by Git.
- Server-side secrets belong in Supabase Edge Function secrets, not the frontend.

Supabase credentials are available under **Project Settings → API** in the Supabase dashboard.

## Project structure

```text
src/
  App.jsx                     Route definitions and lazy-loaded pages
  main.jsx                    React entry point
  index.css                   Tailwind import, theme tokens and base styles
  assets/                     Static assets imported by the app
  components/
    ui/                       Reusable presentational components and auth form controls
    layout/                   App shell (sidebar, header, layout, setup shell, config notice)
  config/
    businessOptions.js        Country, currency, timezone and industry options
    navigation.js             Single source of truth for module navigation
  features/
    auth/                     Auth provider, guards, pages and auth UI components
    onboarding/               Business workspace setup
    workspaces/               Multi-workspace picker
    dashboard/                Dashboard page and dashboard-specific components
    inbox/                    Unified inbox module scaffold
    orders/                   Orders module scaffold
    products/                 Catalogue list, product editor, taxonomy pages, services and helpers
    inventory/                Stock dashboard, item detail, ledger, services and helpers
    customers/                Customers / CRM module scaffold
    payments/                 Payments module scaffold
    reports/                  Reports module scaffold
    team/                     Team and permissions module scaffold
    settings/                 Business settings module scaffold
    not-found/                Fallback route
  hooks/                      Shared React hooks
  lib/
    env.js                    Frontend-safe environment configuration
    supabase/client.js        Centralised Supabase browser client
  services/
    authService.js            Auth, profile, membership and business RPC calls
    catalogueService.js       Catalogue CRUD, taxonomy, search and product-image storage
    inventoryService.js       Inventory search, metrics, stock operations and tracking settings
    baseService.js            Paginated data-access layer and retry helper
  types/
    index.js                  Domain constants and JSDoc typedefs
  utils/                      Formatting, validation, slug, URL and class-name helpers
scripts/
  day3-auth-tests.mjs         Auth, onboarding and RLS integration tests
  day4-catalogue-tests.mjs    Catalogue, storage and RLS integration tests
  day5-inventory-tests.mjs    Inventory balance, ledger, concurrency and RLS integration tests
```

### Architectural rules

- **Feature-based modules.** A feature owns its pages and feature-specific components.
- **Single data-access layer.** Components must not scatter raw Supabase queries. Feature
  service modules will call `src/services` helpers.
- **Single Supabase client.** `src/lib/supabase/client.js` owns client creation so auth
  listeners and token refreshes are not duplicated.
- **Configuration through environment variables.** No secrets or hard-coded project URLs.
- **Single auth state.** `AuthProvider` owns session, profile, memberships, active workspace
  and auth errors. Pages consume `useAuth()` instead of creating their own listeners.
- **Server-enforced authorization.** Route guards improve UX; RLS still decides whether a
  user can read or write a workspace. The client never treats a guard as authorization.
- **No direct tenant writes.** Business creation goes through the `create_business` RPC, and
  membership writes are not exposed in the browser.
- **Atomic catalogue writes.** Product and variant creation/update go through validated RPCs;
  the browser never bypasses catalogue invariants.
- **Soft catalogue lifecycle.** Products are archived instead of hard-deleted, and removed
  variants are kept but marked inactive.
- **Atomic inventory writes.** Stock balances change only through the validated
  `record_stock_operation` RPC, which locks the item, enforces reservation rules and appends an
  immutable ledger row in the same transaction.
- **Private image storage.** Product images use a private bucket, signed URLs and business-scoped
  storage policies.
- **Lazy routes.** Pages are code-split via `React.lazy` to keep the initial bundle small.
- **Shared navigation config.** `src/config/navigation.js` drives both the sidebar and the
  header title so routes cannot drift apart.

## Security measures in this foundation

- No service-role keys or private keys are read by the frontend.
- Local environment files are excluded from version control.
- The Supabase client uses the public anon key with Row Level Security enforced on every
  business-owned table.
- Profiles, businesses and memberships deny all access to `anon`; authenticated users only see
  rows permitted by active membership policies.
- Business creation goes through the atomic `create_business` RPC; the browser never inserts
  business rows or owner memberships directly.
- Roles cannot be escalated by staff or admins, and there are no membership update/delete
  policies.
- Auth redirects are restricted to the configured Site URL and allow list.
- Post-login destinations are validated as internal paths to prevent open redirects.
- Suspended memberships are filtered out of the workspace list and lose access through RLS.
- Catalogue tables require active membership; taxonomy management is limited to owner, admin and
  manager while all four roles can manage products, variants and images.
- Catalogue records cannot move between businesses, category cycles are blocked, SKUs and barcodes
  are unique per business across products and variants, and product currency must match the business.
- The `product-images` bucket is private. Upload paths must match the business and product, and
  signed URLs expire after one hour.
- Inventory balances and stock movements deny direct browser writes. Stock changes require an
  active membership, pass through security-definer RPCs and are recorded in an immutable ledger.
- Stock-operation idempotency keys and row locks prevent duplicate movements and concurrent
  overselling.
- No fake authentication, fake sessions or fake production data is implemented.

## Database (Day 2)

The multi-tenant schema lives in
`supabase/migrations/20261113103545_day2_multi_tenant_foundation.sql`, with a follow-up
privilege-hardening migration in `supabase/migrations/20261113114926_restrict_function_execute.sql`.
Both are documented in [`docs/day2-database.md`](docs/day2-database.md).

```bash
# Load the database password from Windows Credential Manager
. .\scripts\load-supabase-db-password.ps1

# Apply pending migrations to the linked project
supabase db push --linked

# Run the two-tenant isolation and role-escalation test (rolls back)
node scripts/db-query.mjs supabase/tests/rls_isolation.sql
```

Never apply these migrations to a project that contains an unrelated application. The linked
`ORDERFLOWAI` project was cleaned of the previous application's public tables, auth trigger and
auth user before the Day 2 migrations were applied, so it now hosts only the OrderFlow AI schema.

## Product catalogue (Day 4)

Day 4 adds the real catalogue schema, APIs, UI and private image storage. Full implementation
notes and the test matrix are in [`docs/day4-catalogue.md`](docs/day4-catalogue.md).

The schema is in `supabase/migrations/20261114010000_day4_product_catalogue.sql`, with a
follow-up function fix in `supabase/migrations/20261114020000_fix_day4_update_product.sql`.

**Catalogue routes**

| Route | Purpose |
| --- | --- |
| `/products` | Searchable, filterable, paginated product catalogue. |
| `/products/new` | Create a product with attributes and optional variants. |
| `/products/:productId/edit` | Edit product details, variants, status and photos. |
| `/products/categories` | Category hierarchy management. |
| `/products/brands` | Brand management. |
| `/products/attributes` | Reusable product and variant attribute management. |

**Catalogue model**

- Products support `draft`, `active` and `archived`; variants support `active` and `inactive`.
- Products are archived, not hard-deleted. Removing a saved variant marks it inactive.
- Categories support a same-business hierarchy with cycle prevention.
- Attributes can be text, number, boolean or select, and can be product-level or per variant.
- SKUs and barcodes are unique per business across products and variants.
- Products inherit the workspace currency; a mismatch is rejected by a database trigger.
- Images live in the private `product-images` bucket with a 5 MB limit and JPEG, PNG, WebP or AVIF
  MIME types. Paths follow `${businessId}/${productId}/${uuid}.${ext}`.

**Catalogue tests**

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:catalogue
```

The suite exercises taxonomy permissions, category cycles, product creation/update, soft variant
removal, search and filtering, SKU conflicts across tables, currency enforcement, archival,
cross-tenant denial, hard-delete prevention, private uploads, signed URLs, MIME rejection and
image-path validation. It runs 60 checks against the linked project and cleans up its test users,
businesses and storage objects.

## Inventory management (Day 5)

Day 5 turns the Inventory placeholder into a real stock module with balances, reservations,
low-stock alerts and an immutable movement ledger. Full implementation notes and the test matrix
are in [`docs/day5-inventory.md`](docs/day5-inventory.md).

The schema and RPCs are in
`supabase/migrations/20261115010000_day5_inventory_management.sql`.

**Inventory routes**

| Route | Purpose |
| --- | --- |
| `/inventory` | Stock overview, search/filter/pagination, usage metrics and tracking controls. |
| `/inventory/items/:inventoryItemId` | Item balances, stock operations, threshold editing and recent movements. |
| `/inventory/movements` | Immutable stock-movement history with search, operation filter and pagination. |

**Inventory model**

- A product without variants can be tracked at product level. A product with variants is tracked
  separately for each variant.
- `available_quantity` is generated as physical minus reserved stock and can never go below zero.
- Receipts, returns and reservations increase stock; reductions, damage, loss and releases reduce
  stock. Adjustments can move either direction and require a reason.
- Reserving stock changes only the reserved balance. Physical operations cannot consume reserved
  units, and reservations cannot exceed available stock.
- Every successful operation appends an immutable movement row with the actor, reason, signed
  change and previous/new physical and reserved balances.
- Tracking can be disabled only when physical and reserved stock are both zero. Empty unused
  records are removed; records with history remain as untracked so the ledger stays intact.
- Movement idempotency keys and row locks prevent duplicate submissions and concurrent overselling.

**Inventory tests**

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:inventory
```

The suite exercises overview metrics, search/status/category filters, pagination and sorting,
every stock operation, reservation limits, low/out-of-stock transitions, role permissions,
cross-tenant RLS, direct-write denial, product/variant tracking scope, idempotency, concurrent
duplicates, concurrent reservation safety, tracking disable/re-enable behaviour and cleanup.
It runs 96 checks against the linked project and cleans up its test users and businesses.

## Authentication and onboarding (Day 3)

Day 3 adds a complete auth and workspace-entry flow. Full implementation notes and the test
matrix are in [`docs/day3-auth.md`](docs/day3-auth.md).

**Routes**

| Route | Access | Purpose |
| --- | --- | --- |
| `/login`, `/register` | Public | Sign in or create an account. Authenticated users are redirected to the correct post-auth page. |
| `/verify-email` | Public | Resend the signup confirmation email. |
| `/forgot-password` | Public | Request a password recovery email. |
| `/reset-password` | Public | Set a new password from a recovery link. |
| `/auth/callback` | Public | Complete email confirmation and exchange the auth code for a session. |
| `/onboarding` | Authenticated | Create the first business workspace through `create_business`. |
| `/workspaces` | Authenticated | Choose between multiple active workspaces. |
| `/overview` and module routes | Authenticated + active workspace | Protected application shell. |

**State and routing**

- `AuthProvider` loads the session, profile and active memberships, and listens for sign-in,
  sign-out, token refresh, user updates and password recovery.
- One active membership is selected automatically. With multiple memberships, the last valid
  selection is restored from `localStorage`; otherwise the user is sent to `/workspaces`.
- Users with no active membership are sent to `/onboarding`. Suspended memberships are excluded.
- Focus and visibility changes trigger a throttled revalidation so suspended access is removed
  without requiring a full reload.
- `RequireAuth`, `RequireWorkspace` and `RootRedirect` handle UX routing; RLS remains the
  authorization boundary.

**Onboarding**

- Business name, optional industry, country, currency and timezone are validated client-side
  and again by the `create_business` RPC.
- The workspace slug is generated from the business name plus a stable random suffix for the
  current form session.
- Duplicate submissions are blocked by the submit lock and the database unique constraint.
  If the slug already belongs to the same user, the app refreshes memberships and opens it
  instead of creating a duplicate.

**Auth tests**

The integration suite exercises registration, duplicate registration, confirmation gating,
valid/invalid login, logout, invalid recovery tokens, password updates, session persistence,
onboarding, duplicate onboarding, workspace routing, suspended memberships and cross-tenant
RLS denial. It uses the publishable key and database access only for test setup/confirmation/
cleanup; it does not use a service-role key.

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:auth
```

The linked project uses the built-in mailer with a two-email-per-hour limit. When that limit is
reached, the suite skips the live signup/reset email sends, verifies the unconfirmed-user gate
with a directly-created auth user, and still runs the invalid-token, password-update and RLS
checks. Email inbox delivery and link click-through must be verified manually when the rate
limit allows.

## Scalability notes

The foundation is structured for the long-term target of 10,000 concurrent application users,
but this is an engineering direction, not a claim about current free-tier capacity.

- Read helper supports pagination and bounded page sizes (max 100).
- Selective column queries are supported by the data-access layer.
- Supabase RLS enforces tenant isolation at the database level.
- Server-side AI work will run in Edge Functions, never with unrestricted database access.
- Realtime subscriptions will be selective, per feature, rather than global.
- Image delivery will use Supabase Storage.
- Logging, error handling and retry-safe reads are foundational concerns.

## Deployment (Vercel)

1. Import the repository into Vercel.
2. Framework preset: **Vite**. Build command: `npm run build`. Output directory: `dist`.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables.
4. Add the production domain to Supabase Auth **Site URL** and the redirect allow list,
   including `/auth/callback` and `/reset-password`.
5. Deploy and verify client-side routing and email confirmation links.

`BrowserRouter` requires a rewrite so unknown paths serve `index.html`. On Vercel, add a
`vercel.json` rewrite when deployment starts (not required for local development).

## Intentionally not built yet

The following are scheduled for later phases and deliberately excluded from Days 1–5:

- Purchase orders, suppliers and automated replenishment.
- Customer, order and payment workflows.
- AI product discovery and AI order extraction.
- WhatsApp, Instagram or Facebook integrations.
- Visual/image product search.
- Reports based on live data.

## Day 1 acceptance checklist

- [x] React + Vite application runs.
- [x] Tailwind CSS works.
- [x] Supabase client is centralised and environment-driven.
- [x] Environment variable template exists.
- [x] Git ignores sensitive environment files.
- [x] Dashboard shell renders.
- [x] Navigation works across all module routes.
- [x] Mobile layout works with an accessible drawer.
- [x] Folder architecture is organised.
- [x] README explains installation and configuration.
- [x] Production build succeeds.
- [x] No critical browser errors.

## Day 2 acceptance checklist

- [x] Profiles, businesses and business_members schema defined.
- [x] Four-role model (`owner`, `admin`, `manager`, `staff`) enforced by check constraint.
- [x] Membership status values (`active`, `invited`, `suspended`) enforced.
- [x] RLS enabled on every table.
- [x] Atomic, validated `create_business` RPC using `auth.uid()` only.
- [x] Cross-tenant reads and writes blocked by RLS.
- [x] Staff cannot insert memberships or escalate roles.
- [x] Admins cannot assign or grant the owner role.
- [x] Unauthenticated access denied.
- [x] Two-tenant isolation and escalation test written.
- [x] Migration applied to a dedicated Supabase project.
- [x] RLS test executed against the dedicated project.

## Day 3 acceptance checklist

- [x] Email/password registration implemented with required email confirmation.
- [x] Duplicate registration handled without leaking a second account.
- [x] Unconfirmed users are blocked from signing in.
- [x] Valid and invalid login paths produce correct feedback.
- [x] Logout clears the session and active-workspace selection.
- [x] Password recovery request and invalid recovery-token handling implemented.
- [x] Authenticated password updates invalidate the old password.
- [x] Sessions restore from persisted storage.
- [x] Unauthenticated users cannot read or create businesses.
- [x] Onboarding creates a business and owner membership atomically.
- [x] Duplicate onboarding submissions do not create duplicate businesses or memberships.
- [x] Users with no workspace, one workspace and multiple workspaces are routed correctly.
- [x] Suspended memberships lose workspace visibility and access.
- [x] Cross-tenant reads, updates, membership inserts and profile reads are denied.
- [x] Auth/RLS integration tests, lint and production build pass.

## Day 4 acceptance checklist

- [x] Catalogue tables, constraints, indexes and triggers defined.
- [x] Row Level Security and role matrix enforced for all catalogue tables.
- [x] Atomic `create_product`, `update_product` and `create_product_attribute` RPCs.
- [x] Server-side product search and pagination with category, brand and status filters.
- [x] Category hierarchy with cycle prevention.
- [x] Products archive instead of hard-delete; removed variants become inactive.
- [x] SKU and barcode uniqueness enforced across products and variants.
- [x] Product currency tied to the workspace currency.
- [x] Private `product-images` bucket with size/MIME limits and business/product path checks.
- [x] Catalogue list, product editor, category, brand and attribute pages implemented.
- [x] Role-aware taxonomy controls and member product/image access.
- [x] Day 4 catalogue/storage/RLS integration tests pass.
- [x] Day 2 RLS isolation, Day 3 auth tests, lint and production build still pass.
- [x] Day 4 migration applied to the linked Supabase project.

## Day 5 acceptance checklist

- [x] Inventory tables, generated available quantities, constraints and indexes defined.
- [x] Immutable stock-movement ledger and movement-history indexes.
- [x] Row Level Security, read-only direct access and role matrix enforced.
- [x] Atomic stock-operation RPC with row locking, reservation rules and idempotency.
- [x] Product-level and variant-level tracking scope enforced.
- [x] Stock receipts, reductions, adjustments, damage, loss, returns, reservations and releases.
- [x] Low-stock/out-of-stock calculations and server-side inventory search.
- [x] Inventory overview metrics and paginated movement history.
- [x] Inventory dashboard, item detail, stock-operation flow and role-aware tracking controls.
- [x] Tracking disable/re-enable behaviour preserves the movement ledger.
- [x] Day 5 inventory/concurrency/RLS integration tests pass.
- [x] Day 2 RLS isolation, Day 3 auth, Day 4 catalogue, lint and production build still pass.
- [x] Day 5 migration applied to the linked Supabase project.

## License

Proprietary. All rights reserved.

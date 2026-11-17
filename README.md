# OrderFlow AI

AI-powered product discovery and order automation for businesses. OrderFlow AI connects
customer conversations to a business's real product catalogue, order records, inventory and
payments through a single multi-tenant SaaS workspace.

> **Current status: Day 11 — communication infrastructure.**
> The app now has email/password Supabase Auth, protected routes, multi-workspace onboarding,
> a real product catalogue, live inventory with physical, reserved and available stock,
> customer profiles with status, tags, note history, activity and duplicate overrides, orders
> with server-authoritative prices, guest checkout, customer/business confirmation, activity history,
> lifecycle rules and automatic stock reservations, independent payment tracking with partial
> payments, verification, refunds, payment history and currency-aware reporting, public
> per-business storefronts with anonymous catalogue browsing and real order submission, a central
> media layer for product images and store logos, and a provider-independent channel/inbox layer
> with official Meta WhatsApp Cloud API code paths. No WhatsApp account or Cloudinary account is
> claimed connected until real credentials and live tests are completed. AI remains a later phase.

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
- Central media asset lifecycle with provider-independent uploads, usage tracking and safe deletion.
- Cloudinary-ready signed uploads through a Supabase Edge Function with server-side API secrets.
- Catalogue RPCs for atomic product creation/update, attribute creation and catalogue search.
- Live inventory balances for tracked products and variants, with generated available quantities.
- Immutable, append-only stock movements with actor snapshots, reasons and before/after balances.
- Atomic stock operations for receipts, reductions, adjustments, damage, loss, returns, reservations
  and releases, with idempotency and concurrency protection.
- Inventory dashboard with low-stock/out-of-stock filters, overview metrics, tracking controls and
  paginated movement history.
- Customer profiles with normalised email/phone contacts, company names, status, tags and notes.
- Customer address book with labels, recipient details, default-address handling and business-country
  defaults.
- Server-side customer search across name, company, email, phone, tags and address, plus status/tag
  filters and duplicate detection with audited overrides.
- Append-only note history and a read-only activity timeline.
- Customer list, create/edit forms, customer detail, note composer, address dialog and recent order
  history.
- Order list with live metrics, search, status/date filters, sorting and pagination.
- Order editor with linked-customer or walk-in mode, catalogue search, variants, quantities and
  read-only server pricing.
- Order detail page with role-aware status actions, reservation state, totals, activity history and
  cancellation.
- Per-business sequential order numbers and preserved customer/guest/catalogue snapshots.
- Strict order lifecycle with customer confirmation, business approval, automatic reservation,
  release and stock consumption.
- Payment overview, searchable payment directory, payment detail, partial payments, verification,
  rejection, failure handling, refund requests, refund resolution and immutable payment history.
- Currency-aware payment metrics and derived order payment status independent of order fulfilment.
- Default per-business payment methods, sequential payment numbers and idempotent payment/refund RPCs.
- Public per-business storefronts with a slug URL, store profile, search, categories, sorting and pagination.
- Store management for public profile details, logo, published contact information and product visibility.
- Anonymous checkout that creates real shared-order-engine orders with server prices, stock reservation,
  idempotency and no fake payment status.
- Reusable paginated data-access layer with normalised errors and a retry helper.
- Provider-independent channel connection records with server-side credentials and no browser secrets.
- Official Meta WhatsApp Embedded Signup, webhook verification, signed webhook ingestion and Graph API
  send/media paths through Supabase Edge Functions.
- Shared inbox with conversation history, customer/order linkage, assignment, status/handover,
  unread state, opt-outs and 24-hour service-window/template enforcement.
- Idempotent webhook and outbound-message processing with audited delivery states and cross-tenant denial.
- Shared domain constants and JSDoc types for future features.
- ESLint configuration, auth/catalogue/inventory/customer/order/media/communication integration tests
  and a documented Supabase setup workflow.

## Technology stack

| Layer | Technology |
| --- | --- |
| UI | React, Vite |
| Styling | Tailwind CSS |
| Language | JavaScript (ES modules) |
| Auth | Supabase Auth (email/password) |
| Database | Supabase PostgreSQL with Row Level Security |
| Storage | Supabase Storage or Cloudinary through one media adapter layer, with signed delivery URLs |
| Backend functions | Supabase Edge Functions (Cloudinary media signing, deletion and cleanup; Meta WhatsApp connect/webhook/send/media; AI workflows later) |
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
| `npm run test:customers` | Run Day 6 customer profile, status/tag, note, activity, duplicate, address and RLS integration tests (requires `.env.local` and the DB password) |
| `npm run test:orders` | Run Day 7 order lifecycle, stock, numbering, snapshot and RLS integration tests (requires `.env.local` and the DB password) |
| `npm run test:payments` | Run Day 8 payment, refund, reporting, numbering, idempotency and RLS integration tests (requires `.env.local` and the DB password) |
| `npm run test:storefront` | Run Day 9 storefront, checkout, stock reservation, image access and RLS integration tests (requires `.env.local` and the DB password) |
| `npm run test:media` | Run Day 10 media provider, upload lifecycle, storage, public access, RLS and cleanup integration tests (requires `.env.local` and the DB password) |
| `npm run test:comms` | Run Day 11 channel, signature, webhook, inbox, message, media-access, opt-out and RLS integration tests (requires `.env.local` and the DB password) |

## Environment variables

Create `.env.local` from `.env.example`. Only variables prefixed with `VITE_` are exposed to
the browser.

| Variable | Required | Description |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Yes (for data) | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes (for data) | Public browser key: legacy anon key or newer publishable key (`sb_publishable_...`) |
| `VITE_META_APP_ID` | For WhatsApp UI | Public Meta app ID used by Embedded Signup |
| `VITE_META_CONFIG_ID` | For WhatsApp UI | Public Meta Embedded Signup configuration ID |
| `VITE_META_GRAPH_API_VERSION` | No | Graph API version used by frontend links; defaults to `v25.0` |
| `VITE_META_EMBEDDED_SIGNUP_VERSION` | No | Embedded Signup version; defaults to `v4`, supports `v5` |

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
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` are Edge Function secrets
  only. The browser never receives them and Cloudinary is not connected until they are deployed.
- `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY` are Edge Function
  secrets only. The browser receives only the public Meta app/config IDs.
- Channel credentials live in `private.channel_credentials`; authenticated users cannot read tokens and
  service-role RPCs are reserved for deployed server-to-server flows.

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
    channels/                 Channel status and Meta WhatsApp Embedded Signup UI
    inbox/                    Shared inbox, conversation history, composer, assignment and status controls
    orders/                   Order list, editor, detail, status actions, services and helpers
    products/                 Catalogue list, product editor, taxonomy pages, services and helpers
    inventory/                Stock dashboard, item detail, ledger, services and helpers
    customers/                Customer list, profile editor, detail, notes, activity, addresses and helpers
    payments/                 Payment dashboard, detail, recording, refunds, actions and helpers
    storefront/               Public storefront pages, cart context, service layer and store management
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
    customerService.js        Customer search, profiles, tags, notes, activity, duplicates and addresses
    orderService.js           Order search, catalogue, creation, editing, status and cancellation
    paymentService.js         Payment search, summaries, recording, verification, refunds and history
    mediaStorageManager.js    Provider-independent media upload, delete, usage and URL manager
    media/                    Cloudinary/Supabase adapters, URL resolution and media error mapping
    communicationService.js   Channel, conversation, message, send, media, assignment and opt-out API
    baseService.js            Paginated data-access layer and retry helper
  types/
    index.js                  Domain constants and JSDoc typedefs
  utils/                      Formatting, validation, slug, URL and class-name helpers
scripts/
  day3-auth-tests.mjs         Auth, onboarding and RLS integration tests
  day4-catalogue-tests.mjs    Catalogue, storage and RLS integration tests
  day5-inventory-tests.mjs    Inventory balance, ledger, concurrency and RLS integration tests
  day6-customer-tests.mjs     Customer profile, status/tag, note, activity, duplicate, address and RLS tests
  day7-order-tests.mjs        Order lifecycle, stock, numbering, snapshot and RLS integration tests
  day8-payment-tests.mjs      Payment, refund, reporting, numbering, idempotency and RLS integration tests
  day9-storefront-tests.mjs   Storefront, checkout, stock reservation, image access and RLS integration tests
  day10-media-tests.mjs       Media provider, upload lifecycle, access, usage and RLS integration tests
  day11-communication-tests.mjs Channel, webhook, inbox, message, media-access, opt-out and RLS tests
```

Edge functions live in `supabase/functions/media-manager/index.ts`,
`supabase/functions/whatsapp-connect/index.ts`, `supabase/functions/whatsapp-webhook/index.ts`
(with shared `signature.js`), `supabase/functions/whatsapp-send/index.ts` and
`supabase/functions/whatsapp-media/index.ts`.

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
- **Atomic customer writes.** Customer profiles, notes and addresses are created or changed only
  through validated security-definer RPCs; the browser has select-only table access.
- **Atomic order writes.** Order creation, editing, status changes and cancellation go through
  security-definer RPCs. The database enforces numbering, snapshots, transition rules, totals and
  stock reservation in the same transaction.
- **Atomic payment writes.** Payment recording, verification, rejection, failure, refund requests and
  refund resolution go through validated security-definer RPCs. Payment status is derived from
  payment and refund records and never changes order fulfilment automatically.
- **Atomic storefront writes.** Store profile and product visibility changes use validated RPCs.
  Anonymous checkout uses a public order RPC that prices from the catalogue, reserves stock through
  the shared ledger, records idempotency and creates no payment records.
- **Private image storage.** Legacy product images and store logos use private buckets, signed URLs and
  business-scoped storage policies.
- **Central media lifecycle.** New product/logo uploads start, complete, fail and delete through one
  manager and security-definer RPCs. Provider credentials stay server-side.
- **Server-owned communication writes.** Channel connections, conversations, messages, delivery states,
  opt-outs and audit records change through validated security-definer RPCs; the browser cannot write
  credentials or fabricate provider statuses.
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
- Customer tables grant select-only access to active members. Profile, note and address writes go
  through security-definer RPCs. Email/phone duplicates are scoped per business and can only be
  overridden by owners, admins or managers with a recorded reason.
- Customer notes and activity are read-only to clients; direct writes are denied.
- Customer duplicate detection never reads outside the selected business.
- Order tables grant select-only access to active members. Order writes go through security-definer
  RPCs, and order activity cannot be updated after it is written.
- Order numbers are generated atomically per business, and stock can only move through the validated
  inventory ledger during confirmation, cancellation and completion.
- Payment tables grant select-only access to active members. Payment, refund and history writes go
  through security-definer RPCs, with idempotency keys, row locks and immutable events.
- Only verified payments reduce an order balance. Pending, failed and rejected payments do not count,
  and requested refunds reserve refundable value until they are completed or rejected.
- Payment records cannot change order fulfilment, and order actions cannot change payment status.
  Refund and verification actions are limited to owners, admins and managers.
- Public storefront reads use scoped security-definer RPCs; anonymous users cannot select stores,
  storefront idempotency records, products or orders directly.
- Inactive stores, hidden/draft products and cross-business products are excluded from public reads
  and checkout. Client-supplied prices are rejected and stock is reserved with row locks.
- Public images use anon signed URLs only while the product/store is publicly eligible. Store profile
  changes require owner/admin/manager role and product visibility changes require an active membership.
- Media assets are select-only for active members; provider config, limits and lifecycle changes use
  security-definer RPCs with role/platform-admin checks.
- Cloudinary API keys and secret live only in Edge Function secrets. The browser sends the user JWT and
  adapter fields; it never receives service-role credentials or provider secrets.
- Communication credentials are private, provider tokens are never returned to the browser, webhook
  signatures are verified before processing, provider event IDs are idempotent, and delivery/read states
  require real webhook events.
- Cross-business conversation, message, media, assignment and opt-out operations are denied by RPC
  checks and RLS; channel writes require an active membership through server-side RPCs.
- No fake authentication, fake sessions, fake payment gateways, fake uploads, fake connected accounts,
  fake messages or fake production data is implemented.

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

## Customer management (Day 6)

Day 6 turns the Customers placeholder into a real customer module with profiles, contact details,
addresses, status, tags, note history, activity and duplicate detection. Full implementation notes
and the test matrix are in [`docs/day6-customers.md`](docs/day6-customers.md).

The base schema and RPCs are in `supabase/migrations/20261116010000_day6_customer_management.sql`.
The CRM enhancements are in `supabase/migrations/20261118010000_day6_crm_enhancements.sql`.

**Customer routes**

| Route | Purpose |
| --- | --- |
| `/customers` | Searchable, status/tag-filterable, sortable, paginated customer list. |
| `/customers/new` | Create a customer with validated contact details, status and tags. |
| `/customers/:customerId` | Contact details, tags, note history, activity and recent order history. |
| `/customers/:customerId/edit` | Edit the customer profile, status and tags. |

**Customer model**

- Customers require at least one email address or phone number.
- Emails are normalised to lowercase. Rwanda phone numbers are normalised to `250...` so local and
  international formats match.
- Exact email and phone duplicates are blocked per business by default. Owners, admins and managers
  can override with a 3–240 character reason; overrides are recorded in the activity timeline.
- A matching name without matching contact details is a warning, not a block.
- Status is `active`, `inactive` or `archived`. Tags are lowercase, unique, limited to 20 per
  customer and 40 characters each.
- Notes are append-only history entries, while the activity timeline records profile, status, tag,
  note and address changes.
- Customers can have multiple labelled addresses, with exactly one default address. Deleting the
  default promotes the earliest remaining address.
- Addresses inherit the business country unless a valid two-letter country code is supplied.
- Customer search covers name, company, email, phone, tags and address text.
- Customer order history now shows real orders created in the Day 7 order module.

**Roles and RPCs**

- All four active roles can create and edit customers, notes and addresses.
- Only owners, admins and managers can override duplicate contact details.
- Table access is select-only for active members; direct insert/update/delete is denied.
- Writes require authentication and active membership through `create_customer`, `update_customer`,
  `add_customer_note`, `save_customer_address` and `delete_customer_address`.
- Duplicate detection uses `find_customer_duplicates`; listing, lookup, filters and tag listing use
  `search_customers` and `list_customer_tags`.

**Customer tests**

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:customers
```

The suite exercises profile validation, email/phone normalisation, duplicate blocking/overrides,
status and tags, tags listing, search/filter/sort/pagination, note history, activity events, address
defaults and promotion, role permissions, direct-write denial, cross-tenant RLS, isolation and
cleanup. It runs 219 checks against the linked project and cleans up its test users, businesses and
customer records.

## Order management (Day 7)

Day 7 turns the Orders placeholder into a real order module with drafts, item pricing, lifecycle
rules, activity history and automatic stock reservations. Full implementation notes and the test
matrix are in [`docs/day7-orders.md`](docs/day7-orders.md).

The schema and RPCs are in `supabase/migrations/20261117010000_day7_order_management.sql`, with the
lifecycle, guest-order and server-pricing hardening in
`supabase/migrations/20261119010000_day7_order_lifecycle_guests.sql`.

**Order routes**

| Route | Purpose |
| --- | --- |
| `/orders` | Order list with metrics, search, status/date filters, sorting and pagination. |
| `/orders/new` | Create an order, optionally prefilled with `?customerId=`. |
| `/orders/:orderId` | Items, totals, customer, activity, stock state and lifecycle actions. |
| `/orders/:orderId/edit` | Edit a draft or awaiting order. |

**Order model**

- Orders require a same-business customer or a walk-in guest name. Customer or guest name, phone and
  email are snapshotted.
- Items preserve product, variant and SKU snapshots while the server captures the catalogue unit price.
  Client-supplied price and line-total fields are rejected.
- Totals are recalculated from line totals by a database trigger.
- Order numbers use a per-business atomic counter: `ORD-00001`, `ORD-00002`, and so on.
- Status moves strictly through `draft`, `awaiting_confirmation`, `awaiting_business_approval`,
  `confirmed`, `processing`, `ready` and `completed`; cancellation is available until completion.
- Only draft and awaiting orders can be edited. Confirmed orders cannot be changed.
- Customer confirmation precedes business approval. Business approval reserves tracked stock,
  cancellation releases it, and fulfilment releases then reduces physical stock. Untracked units
  create no stock movement.
- Created, updated, confirmation, approval, stock, fulfilment and cancellation events form an
  immutable activity history.
- Customer detail pages show the five most recent orders and link to their detail pages.

**Order roles and RPCs**

- All four active roles can create, edit, confirm customer intent, process and cancel orders.
  Owner, admin and manager roles are required for business approval and fulfilment.
- Order tables are select-only for active members; direct insert/update/delete is denied.
- `create_order`, `update_order`, `update_order_status` and `cancel_order` perform all writes.
- `search_orders` powers the list, `search_order_catalogue` powers the editor and
  `get_order_overview` supplies list metrics.

**Order tests**

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:orders
```

The suite exercises numbering and concurrent creation, customer/guest/catalogue snapshots,
server-authoritative pricing, variant rules, validation errors, customer confirmation, business
approval, every legal and illegal status transition, stock reservation, cancellation release,
fulfilment consumption, activity immutability, direct-write denial, search/filter/sort/pagination,
date filters, overview metrics, role permissions, cross-tenant RLS and cleanup.
It runs 232 checks against the linked project and cleans up its test users and businesses.

## Payment management (Day 8)

Day 8 turns the Payments placeholder into a real payment module with partial payments, verification,
refunds, audit history and currency-aware reporting. Full implementation notes and the test matrix
are in [`docs/day8-payments.md`](docs/day8-payments.md).

The schema and RPCs are in
`supabase/migrations/20261120010000_day8_payment_management.sql`.

**Payment routes**

| Route | Purpose |
| --- | --- |
| `/payments` | Metrics, search, status/method/date filters, sorting and paginated payment directory. |
| `/payments/new` | Record a payment against a payable order, optionally prefilled with `?orderId=`. |
| `/payments/:paymentId` | Payment details, order summary, verification actions, refunds and event history. |

**Payment model**

- Payment records use `pending`, `verified`, `rejected` and `failed`. Only `verified` records count
  toward the order balance.
- Order payment status is derived as `pending`, `partially_paid`, `paid`, `failed`, `refunded` or
  `partially_refunded`; order fulfilment status remains independent.
- Payments are allowed only for `confirmed`, `processing`, `ready` and `completed` orders.
- Amounts are positive, limited to two decimals and cannot exceed the outstanding verified balance.
- Payment numbers use a per-business atomic counter: `PAY-00001`, `PAY-00002`, and so on.
- Default methods are cash, bank transfer, mobile money, card and other, seeded per business.
- Refunds use `requested`, `completed` and `rejected`. Requested refunds reserve refundable value;
  completed refunds reduce net paid; rejected refunds release the reservation.
- Idempotency keys prevent duplicate payments and refunds, and provider event IDs are unique per
  business/provider pair.
- Created, verified, rejected, failed, refund-requested, refund-completed and refund-rejected events
  form an immutable payment history.

**Payment roles and RPCs**

- All active roles can record payments and request refunds.
- Owners, admins and managers can verify, reject or fail payments and complete or reject refunds.
- Payment tables are select-only for active members; direct insert/update/delete is denied.
- `record_payment`, `verify_payment`, `reject_payment`, `fail_payment`, `request_refund`,
  `complete_refund` and `reject_refund` perform all writes.
- `search_payments`, `get_payment`, `get_order_payment_summary`, `search_payable_orders`,
  `get_payment_overview` and `list_payment_methods` power reads and reporting.

**Payment tests**

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:payments
```

The suite exercises method seeding and isolation, payable-order rules, validation limits, partial
payments, verification and failure flows, role permissions, refund reservations and resolution,
order/payment status separation, currency-aware overview metrics, payable-order filtering, numbering,
idempotency, provider-event conflicts, search/filter/sort/pagination, immutable history,
direct-write denial, cross-tenant RLS and cleanup. It runs 199 checks against the linked project and
cleans up its test users, businesses, payments and refunds.

## Public storefront (Day 9)

Day 9 adds a real public storefront for every business. Full implementation notes, the checkout
contract, security model and test matrix are in
[`docs/day9-storefront.md`](docs/day9-storefront.md).

The schema and RPCs are in
`supabase/migrations/20261121010000_day9_public_storefront.sql`, with the locked stock-reservation
fix in `supabase/migrations/20261121020000_day9_storefront_stock_reservation_fix.sql`.

**Storefront routes**

| Route | Purpose |
| --- | --- |
| `/store/:storeSlug` | Public catalogue with search, categories, sorting and pagination. |
| `/store/:storeSlug/products/:productId` | Public product detail, variants and add-to-cart. |
| `/store/:storeSlug/checkout` | Anonymous checkout with server-priced order summary. |
| `/store` | Workspace store profile, logo, contact details and product visibility. |

**Storefront model**

- Each business gets one store automatically; slugs are unique and stores can be active or inactive.
- `products.storefront_visible` defaults to `false`; only active, published products are public.
- Public catalogue queries use active stores only and exclude draft, archived, hidden and
  cross-business products.
- Product images and store logos stay in private buckets and are exposed through anon signed URLs
  only while publicly eligible.
- Checkout validates customer details and items, rejects client prices, creates a real order in
  `awaiting_business_approval`, stores delivery details in order notes, reserves tracked stock and
  logs a `customer_confirmed` event.
- Checkout idempotency records one response per business/key and returns the original order on retry.
- No payment is recorded; payment remains `pending` and is handled later through Day 8.
- Customer links are conservative: only an exact email plus normalized phone match one existing
  customer in the business.

**Storefront tests**

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:storefront
```

The suite exercises store creation and isolation, profile/contact/validation rules, role checks,
public catalogue filtering, signed private image access, checkout validation, server pricing, stock
reservation, event logging, idempotency, customer matching, inactive-store blocking and cleanup. It
runs 110 checks and cleans up its test users, businesses and storage objects.

## Media storage and asset management (Day 10)

Day 10 adds a single media lifecycle for product images and store logos while preserving all Day 4
and Day 9 private storage paths and signed URLs. Full implementation notes, RPCs, Cloudinary secret
setup and the test matrix are in [`docs/day10-media-storage.md`](docs/day10-media-storage.md).

The schema is in `supabase/migrations/20261122010000_day10_media_storage.sql`, the URL resolver is in
`supabase/migrations/20261122020000_day10_media_url_resolver.sql`, and the filename-check fix is in
`supabase/migrations/20261122030000_day10_media_filename_check_fix.sql`. The Edge Function is in
`supabase/functions/media-manager/index.ts`.

**Media model**

- The active provider is stored server-side in `public.media_provider_config`; the current project uses `supabase`.
- Every upload is tracked in `media_assets` with idempotent client request IDs, size/type/dimensions and status.
- Supabase uploads use signed upload URLs; Cloudinary uploads use short-lived signed fields from the Edge Function.
- `cloudinary:<public_id>` references are accepted only when linked to a ready media asset for the same business.
- Product images and store logos record `media_asset_id`; legacy paths and public eligibility rules remain unchanged.
- Upload progress, replacement, removal and business usage totals are wired into the existing product and store UI.
- Cloudinary secrets are Edge Function-only; the adapter is implemented but not connected or live-tested.

**Media tests**

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:media
```

The suite runs 89 checks covering provider config authorization, validation, RLS, idempotent upload
start, signed storage upload, completion, product/logo attachment, public access, URL resolution,
usage, failures, attached-asset delete protection, limits, removal and cleanup.

## Communication infrastructure (Day 11)

Day 11 adds provider-independent channel records, official Meta WhatsApp Business Cloud API paths,
signed webhook ingestion, a shared inbox and server-authorized messages. Full implementation notes,
RPCs, Edge Function secrets, status boundaries and the test matrix are in
[`docs/day11-communication-infrastructure.md`](docs/day11-communication-infrastructure.md).

The schema and RPCs are in
`supabase/migrations/20261123010000_day11_communication_infrastructure.sql`, with a corrected webhook
function applied separately after the migration.

**Communication routes**

| Route | Purpose |
| --- | --- |
| `/channels` | WhatsApp connection status, Embedded Signup and disconnect control. |
| `/inbox` | Shared conversation list, history, customer/order panel, composer, assignment and status controls. |

**Communication model**

- Credentials live in `private.channel_credentials`; the browser only sees connection metadata.
- Meta Embedded Signup defaults to v4; v2/v3 are deprecated and v5 is available by configuration.
- Inbound webhooks verify `X-Hub-Signature-256` before processing and use provider message IDs for idempotency.
- Customer matching uses normalized `from` phone numbers; names alone never merge customers.
- Outbound creation enforces 24-hour windows, templates, opt-outs and same-business ready media assets.
- API acceptance is separate from webhook delivery/read/failure states.
- Assignment, status changes and opt-outs are audited and blocked across businesses.

**Communication tests**

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:comms
```

The suite runs 101 checks with local fixtures only. It covers signatures, RLS, credential protection,
webhook ingestion, duplicates, customer matching, service windows, templates, idempotent sends,
delivery states, opt-outs, media ownership, assignment, pagination and cross-tenant denial. No real
WhatsApp message is sent. A
real WABA, deployed Edge Functions and production approval are still required before connectivity or
message delivery can be claimed.

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

`BrowserRouter` requires a rewrite so unknown paths serve `index.html`. `vercel.json` provides the
catch-all rewrite, so direct links such as `/login`, `/customers` and `/store/:storeSlug` load the app
instead of a Vercel 404.

## Intentionally not built yet

The following are scheduled for later phases and deliberately excluded or still incomplete after Days 1–11:

- Purchase orders, suppliers and automated replenishment.
- Invoices and live payment-provider gateway integrations.
- Public online payment collection on storefront orders.
- AI product discovery and AI order extraction.
- Instagram or Facebook channel integrations. WhatsApp infrastructure is implemented but not connected
  to a real WABA or approved for production.
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

## Day 6 acceptance checklist

- [x] Customer tables, contact constraints, normalised phone storage and indexes defined.
- [x] Customer status, tags, note history and activity timeline added.
- [x] Row Level Security and active-membership access enforced.
- [x] Select-only table grants; customer, note and address writes require security-definer RPCs.
- [x] Atomic create/update customer RPCs with validated email, phone, status, tags and contact requirements.
- [x] Per-business email and phone duplicate protection with audited owner/admin/manager overrides.
- [x] Duplicate detection for email, phone and name, excluding the edited customer and other businesses.
- [x] Append-only notes and read-only activity events.
- [x] Address create/update/delete RPCs with one default per customer and promotion on delete.
- [x] Address country defaults to the business country and validates ISO two-letter codes.
- [x] Server-side customer search across name, company, email, phone, tags and address.
- [x] Status/tag filters, pagination, sorting and full filtered totals.
- [x] Customer list, create/edit form, detail page, note composer and address dialog implemented.
- [x] Customer detail shows tags, note history, activity and real Day 7 order history.
- [x] Day 6 customer/status/tag/note/activity/address/RLS integration tests pass (219 checks).
- [x] Day 2 RLS isolation, Day 3 auth, Day 4 catalogue, Day 5 inventory, lint and production build
  still pass.
- [x] Day 6 base and CRM enhancement migrations applied to the linked Supabase project.

## Day 7 acceptance checklist

- [x] Order counter, order, item and activity tables with constraints and indexes defined.
- [x] Per-business sequential order numbers generated atomically.
- [x] Same-business customer or walk-in guest with preserved contact snapshots.
- [x] Catalogue item snapshots, server-authoritative prices and generated line totals.
- [x] Automatic order total recalculation.
- [x] Strict forward-only lifecycle with customer confirmation, business approval and reason-based cancellation.
- [x] Editing limited to draft and awaiting orders.
- [x] Stock reservation on business approval, release on cancellation and consumption on fulfilment.
- [x] Immutable, append-only activity history with actor, approval and stock events.
- [x] Row Level Security and select-only client access for all order tables.
- [x] Atomic order creation, editing, status and cancellation RPCs.
- [x] Server-side order search, status/customer/date filters, sorting, pagination and overview metrics.
- [x] Order list, create/edit editor, detail page and cancellation dialog implemented.
- [x] Customer detail page shows real recent order history.
- [x] Day 7 order/lifecycle/stock/RLS integration tests pass.
- [x] Day 2 RLS isolation, Day 3 auth, Day 4 catalogue, Day 5 inventory, Day 6 customer, lint and
  production build still pass.
- [x] Day 7 migration applied to the linked Supabase project.

## Day 8 acceptance checklist

- [x] Payment methods, counters, payments, refunds and immutable payment-event tables defined.
- [x] Default payment methods seeded for existing and new businesses.
- [x] Row Level Security, select-only client grants and active-membership access enforced.
- [x] Per-business sequential payment numbers generated atomically.
- [x] Payment record statuses and derived order payment statuses implemented separately from fulfilment.
- [x] Only verified payments reduce balances; pending, failed and rejected records are excluded.
- [x] Partial payments, verification, rejection and failure flows implemented.
- [x] Refund requests, completion and rejection with reserved/completed value tracking implemented.
- [x] Payment and refund idempotency, provider-event uniqueness and row locking enforced.
- [x] Atomic payment and refund RPCs with role checks and validated amounts, reasons and metadata.
- [x] Server-side payment search, filters, sorting, pagination, payable-order search and overview metrics.
- [x] Currency-aware payment metrics and reporting.
- [x] Payment directory, record-payment form, payment detail, order payment summary and action dialogs implemented.
- [x] Payment history is append-only and direct client writes are denied.
- [x] Day 8 payment/refund/reporting/RLS integration tests pass (199 checks).
- [x] Day 2 RLS isolation, Day 3 auth, Day 4 catalogue, Day 5 inventory, Day 6 customer, Day 7 order,
  lint and production build still pass.
- [x] Day 8 migration applied to the linked Supabase project.

## Day 9 acceptance checklist

- [x] Each business automatically gets one validated, unique store record.
- [x] Store status controls all public reads and checkout access.
- [x] Store profile, logo and published contact details are managed from the workspace.
- [x] Product visibility defaults to hidden and is controlled by active members.
- [x] Public catalogue supports search, categories, sorting, pagination and product detail.
- [x] Inactive, hidden, draft and cross-business products cannot be viewed or ordered publicly.
- [x] Product images and store logos remain private and use anon signed URLs when eligible.
- [x] Anonymous checkout creates real orders in the shared order engine with server prices.
- [x] Checkout reserves stock through locked inventory rows and the immutable stock ledger.
- [x] Checkout is idempotent and logs an `Online storefront` customer-confirmed event.
- [x] Checkout creates no payment records and leaves derived payment status pending.
- [x] Customer links require an exact email plus normalized phone match.
- [x] Internal reservation and management RPCs are denied to anonymous and cross-business users.
- [x] Day 9 storefront/checkout/stock/RLS integration tests pass (110 checks).
- [x] Day 2 RLS isolation through Day 8, lint and production build still pass.
- [x] Day 9 storefront and stock-reservation-fix migrations applied to the linked Supabase project.

## Day 10 acceptance checklist

- [x] Central media assets track provider, status, size, type, metadata and business ownership.
- [x] Active provider is server-side; the current project uses Supabase Storage.
- [x] Cloudinary signed-upload, verification, delete and cleanup actions are implemented server-side.
- [x] Cloudinary keys are Edge Function secrets and are never exposed to the browser.
- [x] Product images and store logos can use tracked assets while legacy paths remain valid.
- [x] Upload validation, idempotency, limits, RLS and role checks are enforced by RPCs.
- [x] Upload progress, replacement, removal and storage usage are available in the UI.
- [x] Public storefront product/logo URLs support both legacy private paths and Cloudinary references.
- [x] Day 10 media/storage/RLS integration tests pass (89 checks).
- [x] Day 2 RLS isolation through Day 9, lint and production build still pass.
- [x] Day 10 media, URL-resolver and filename-fix migrations applied to the linked Supabase project.
- [ ] Cloudinary live upload/delete verified after real credentials and Edge Function deployment.

## Day 11 acceptance checklist

- [x] Provider-independent channel, connection, credential, conversation, message, webhook, audit and
  opt-out tables defined.
- [x] Provider credentials are private and inaccessible to browser users.
- [x] Meta WhatsApp Embedded Signup, webhook verification/signature, send and media Edge Function code
  paths implemented.
- [x] Signed webhook ingestion verifies HMAC-SHA256 before processing.
- [x] Duplicate provider events and duplicate send requests are idempotent.
- [x] Conversations link to same-business customers and real orders without name-only merging.
- [x] Outbound messages enforce 24-hour windows, templates, opt-outs and media ownership.
- [x] Delivery/read/failure states come from webhook events, not client claims.
- [x] Assignment, status, unread and opt-out changes are audited and role/membership checked.
- [x] Shared inbox and channel pages use the central service layer.
- [x] Row Level Security, direct-write denial and cross-tenant denial are enforced.
- [x] Day 11 communication/webhook/RLS integration suite passes (101 checks).
- [x] Day 11 suite, lint, build and Days 3–10 regressions verified.
- [x] Day 11 migration applied to the linked Supabase project.
- [ ] Meta app credentials, webhook URL, real WABA and phone number verified in a Meta test environment.
- [ ] Edge Functions deployed and a real outbound message/webhook round trip verified.
- [ ] Production approval and live channel connectivity verified.

## License

Proprietary. All rights reserved.

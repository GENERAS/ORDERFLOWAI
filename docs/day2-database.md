# Day 2 — Multi-tenant database foundation

This document describes the Day 2 schema, RLS model, business-creation RPC and the workflow for
applying and testing it. The migrations are:

```text
supabase/migrations/20261113103545_day2_multi_tenant_foundation.sql
supabase/migrations/20261113114926_restrict_function_execute.sql
```

> **Project state.** The linked `ORDERFLOWAI` project previously contained an unrelated
> application. Its public tables, `on_auth_user_created` trigger and pre-existing auth user were
> removed before the Day 2 migrations were applied. The project now hosts only the OrderFlow AI
> schema. Do not reintroduce unrelated schemas into it.

## Goals

- One user can belong to multiple businesses.
- Every business-owned row is isolated by RLS.
- Four roles only: `owner`, `admin`, `manager`, `staff`.
- Membership status: `active`, `invited`, `suspended`.
- Business creation is atomic and happens through a validated RPC.
- Staff cannot insert memberships or escalate roles.
- Admins can add managers/staff but cannot grant `owner`.
- Anonymous users get no access to private tables or the RPC.

## Tables

### `public.profiles`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key, references `auth.users(id)` on delete cascade |
| `full_name` | `text` | Null or 1–160 trimmed characters |
| `avatar_url` | `text` | Nullable |
| `created_at` | `timestamptz` | Defaults to `now()` |
| `updated_at` | `timestamptz` | Defaults to `now()`, maintained by trigger |

Created automatically by the `on_auth_user_created` trigger after a row is inserted into
`auth.users`. A backfill inserts profiles for existing auth users. Phone and email are
intentionally **not** stored in the profile; email lives in `auth.users`.

### `public.businesses`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key, defaults to `gen_random_uuid()` |
| `name` | `text` | Required, 1–160 trimmed characters |
| `slug` | `text` | Required, unique, 2–80 chars, `^[a-z0-9]+(-[a-z0-9]+)*$` |
| `industry` | `text` | Nullable, 1–80 trimmed characters |
| `country` | `text` | Required, two uppercase letters, default `RW` |
| `currency` | `text` | Required, three uppercase letters, default `RWF` |
| `timezone` | `text` | Required, 1–80 chars, validated against `pg_timezone_names` by the RPC |
| `created_at` | `timestamptz` | Defaults to `now()` |
| `updated_at` | `timestamptz` | Maintained by trigger |

### `public.business_members`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key, defaults to `gen_random_uuid()` |
| `business_id` | `uuid` | References `businesses(id)` on delete cascade |
| `user_id` | `uuid` | References `auth.users(id)` on delete cascade |
| `role` | `text` | `owner`, `admin`, `manager` or `staff` |
| `status` | `text` | `active`, `invited` or `suspended`, default `active` |
| `created_at` | `timestamptz` | Defaults to `now()` |

Unique on `(business_id, user_id)`. Indexed on `user_id`. There is intentionally no
`updated_at` and no update/delete policy.

## Relationships

```text
auth.users 1 ─── 1 public.profiles
auth.users 1 ─── * public.business_members
public.businesses 1 ─── * public.business_members
```

`business_members` is the join table that grants a user access to a business. Access requires
`status = 'active'`; `invited` and `suspended` memberships grant no read or write access.

## Roles

| Role | Intended capabilities |
| --- | --- |
| `owner` | Full control, can add any role including `admin`; only owners can grant `owner` |
| `admin` | Can manage business settings and add `manager`/`staff`; cannot grant `owner` or `admin` |
| `manager` | Read-only at the database layer for Day 2; operational permissions arrive with modules |
| `staff` | Read-only at the database layer for Day 2; cannot manage memberships |

Day 2 establishes the database boundaries. Feature-level permissions (for example who can edit
products or refund payments) will be added with those modules.

## RLS policy matrix

RLS is enabled on all three tables. All policies target `authenticated` only.

| Table | Operation | Policy | Rule |
| --- | --- | --- | --- |
| `profiles` | SELECT | `profiles_select_own` | `id = auth.uid()` |
| `profiles` | SELECT | `profiles_select_business_members` | `shares_business_with(id)` |
| `profiles` | UPDATE | `profiles_update_own` | own profile only |
| `businesses` | SELECT | `businesses_select_members` | active membership in the business |
| `businesses` | UPDATE | `businesses_update_managers` | active `owner`/`admin` |
| `business_members` | SELECT | `business_members_select_own_businesses` | active membership in the business |
| `business_members` | INSERT | `business_members_insert_managers` | active `owner`/`admin`, not self, and role rules below |

Membership insert rules:

- `owner` can insert `manager` or `staff` for other users.
- `owner` can insert `admin` or `owner`.
- `admin` can insert `manager` or `staff`.
- `admin` cannot insert `admin` or `owner`.
- No user can insert a membership for themselves.
- There is no UPDATE or DELETE policy, and no UPDATE/DELETE grant on `business_members`, so
  roles and memberships cannot be changed through the API.

Helper functions are `SECURITY DEFINER` with `search_path = public, pg_temp`:

- `is_business_member(uuid)` — active membership check.
- `has_business_role(uuid, text[])` — active membership with one of the supplied roles.
- `shares_business_with(uuid)` — both users have active memberships in a shared business.

## `create_business` RPC

```sql
public.create_business(
  business_name text,
  business_slug text,
  business_industry text default null,
  business_country text default 'RW',
  business_currency text default 'RWF',
  business_timezone text default 'Africa/Kigali'
) returns public.businesses
```

Behavior:

- Requires `auth.uid()`; otherwise raises `28000`.
- Normalizes name/slug/industry (trim, lowercase slug) and country/currency (uppercase).
- Validates name, slug, industry, country, currency and timezone; invalid input raises `22023`.
- Inserts the business and the caller's `owner`/`active` membership in one transaction.
- Converts a duplicate slug into `23505` with a friendly message.
- Runs as `SECURITY DEFINER` with a restricted `search_path`.

The browser calls this RPC instead of inserting into `businesses` or `business_members`
directly.

## Privileges

- `anon`: no table privileges and no execute on helper functions or `create_business`.
- `authenticated`:
  - `profiles`: `SELECT`; `UPDATE (full_name, avatar_url)`.
  - `businesses`: `SELECT`; `UPDATE (name, slug, industry, country, currency, timezone)`.
  - `business_members`: `SELECT`; `INSERT (business_id, user_id, role, status)`.
  - Execute on helper functions and `create_business`.
- `service_role`: retains default privileges and bypasses RLS; server-side only.

## Applying the migration

```powershell
# 1. Store the database password once (Windows Credential Manager)
cmdkey /generic:OrderFlowAI:supabase-db /user:postgres /pass:<new-db-password>

# 2. Load it into the current shell
. .\scripts\load-supabase-db-password.ps1

# 3. Link the dedicated project
supabase link --project-ref <new-project-ref>

# 4. Confirm what will run (no changes)
supabase db push --linked --dry-run

# 5. Apply
supabase db push --linked
```

After linking, update `.env.local` with the new project URL and publishable/anon key:

```dotenv
VITE_SUPABASE_URL=https://<new-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<new-publishable-key>
```

Never put the database password, service-role key or other secrets in `VITE_` variables.

## Testing isolation and escalation

The test is `supabase/tests/rls_isolation.sql`. It runs entirely inside a transaction and rolls
back, so it does not leave test users or businesses behind. Last run: **2026-11-13, passed**
against the linked `ORDERFLOWAI` project. The test starts from an empty auth table and rolls back
all test users.

```powershell
. .\scripts\load-supabase-db-password.ps1
node scripts/db-query.mjs supabase/tests/rls_isolation.sql
```

Expected final row:

```text
result
RLS isolation and role escalation tests passed
```

The test covers:

1. Tenant A owner creates Business A through the RPC; invalid slug and invalid timezone are
   rejected.
2. Tenant B creates Business B; duplicate slug is rejected.
3. Tenant B cannot read or update Business A, its memberships or its owner's profile.
4. Cross-tenant membership inserts are blocked.
5. Staff C can read Business A, cannot read Business B, cannot update Business A settings,
   cannot insert memberships and cannot escalate their own role.
6. Admin D can update Business A and add staff E, but cannot escalate their own role or grant
   `owner`.
7. Added staff E can read Business A and cannot read Business B.
8. Suspended staff C loses read access to Business A and its memberships.
9. `anon` cannot read any private table and cannot execute `create_business`.

## Manual Supabase steps

The linked `ORDERFLOWAI` project is already cleaned, linked and migrated. For a fresh project:

1. Create a new project (for example `orderflow-ai`) in the required region.
2. Copy the project ref, project URL and publishable/anon key into `.env.local`.
3. Store the database password with `cmdkey` as shown above.
4. Link with `supabase link --project-ref <ref>`.
5. Apply the migrations and run the test.
6. In **Authentication → Providers**, keep email/password configured for Day 3.
7. Confirm **Authentication → Users** shows no test users after the test (the test rolls back).

## Limitations and follow-ups

- No invitation flow yet: inserting an `invited` membership does not send an email.
- No membership removal or role-change API by design; those need explicit, audited RPCs.
- No audit log for membership changes.
- No email/phone in `profiles`; query `auth.users` through a server-side function if needed.
- `manager` and `staff` are read-only at the database layer until feature modules define their
  permissions.
- `create_business` allows a user to create multiple businesses; no per-user ownership limit.
- Timezone validation uses `pg_timezone_names`, which accepts historical and alias names too.
- The schema has not been load-tested. Do not claim support for 10,000 concurrent users without
  load testing; the Day 1 architecture is a direction, not a capacity guarantee.
- RLS tests passed on 2026-11-13 against the linked project. Re-run them after any policy,
  helper-function or grant change.

# Day 6 — Customer management

## Scope

Day 6 turns the Customers placeholder into a real multi-tenant customer module. It adds:

- Customer profiles with names, companies, email addresses, phone numbers, status and tags.
- Normalised contact storage and per-business duplicate protection, with audited override for
  owners, admins and managers.
- Duplicate detection before saving, with blocking contact matches and name-only warnings.
- A customer address book with labels, recipient details, default-address handling and country
  defaults.
- Append-only note history and a read-only customer activity timeline.
- Server-side customer search, status/tag filters, sorting and pagination.
- Customer list, create/edit form, customer detail, note composer and address dialog.
- Customer, address, note, activity, duplicate and RLS integration tests.

Day 6 does **not** add orders, payments or AI workflows. At the end of Day 6, the customer detail
page showed an explicit order-history placeholder; no order records were created or invented.
Day 7 later replaced that placeholder with real recent order history.

## Migration

| Migration | Purpose |
| --- | --- |
| `20261116010000_day6_customer_management.sql` | Customer and address tables, constraints, indexes, RLS, duplicate detection and RPCs. |
| `20261118010000_day6_crm_enhancements.sql` | Customer status/tags, note history, activity timeline, filters, tag listing, duplicate overrides and refreshed RPCs. |

Both migrations have been applied to the linked Supabase project.

## Data model

| Table | Purpose |
| --- | --- |
| `customers` | One profile per customer in a business. |
| `customer_addresses` | Delivery/billing addresses owned by a customer. |
| `customer_notes` | Append-only internal notes for a customer. |
| `customer_events` | Read-only activity timeline for profile, note and address changes. |

### `customers`

- `business_id`, `full_name`, optional `company_name`, `email`, `phone`, `notes`, `status` and
  `tags`.
- `status` is one of `active`, `inactive` or `archived` and defaults to `active`.
- `tags` is a `text[]` of up to 20 lowercase, trimmed, unique values; each tag is at most 40
  characters. A GIN index supports tag filtering.
- `phone_normalized` stores the canonical digits used for duplicate checks.
- `created_by` and `updated_by` reference the acting auth user.
- `created_at` and `updated_at` are server-managed.
- Checks enforce a 1–160 character name, valid email shape, 7–32 character phone display value,
  7–15 normalized phone digits, notes up to 2,000 characters, and at least one contact method.
- Non-unique indexes on `(business_id, lower(email))` and `(business_id, phone_normalized)` support
  duplicate detection. Duplicate protection is enforced by the RPCs so authorized overrides can be
  audited.
- `notes` remains the latest note snapshot for backward compatibility; the complete history lives in
  `customer_notes`.
- Name, created, updated, status and tag indexes support search and sorting.

### `customer_notes`

- `business_id`, `customer_id`, `body`, `author_name`, `created_by` and `created_at`.
- Notes are append-only: clients can select them, but only RPCs can insert. No update/delete grants
  are issued.
- Body length is 1–2,000 characters. The customer foreign key cascades on customer/business delete.
- Existing `customers.notes` values were migrated into note history.

### `customer_events`

- `business_id`, `customer_id`, `event_type`, `description`, `actor_id`, `actor_name` and
  `created_at`.
- Event types cover customer creation, profile updates, status changes, tag changes, notes, address
  add/update/delete and duplicate overrides.
- Events are read-only to clients and written by security-definer RPCs and triggers.

### `customer_addresses`

- `business_id`, `customer_id`, optional `label` and `recipient_name`.
- `line1` is required; `line2`, `city`, `region` and `postal_code` are optional.
- `country` is a required two-letter uppercase ISO code.
- `is_default` marks the address to use first for future orders.
- A partial unique index ensures at most one default address per customer.
- The composite foreign key `(business_id, customer_id)` prevents moving an address across
  businesses or attaching it to a customer in another tenant.
- Addresses cascade-delete with their customer or business.

## Contact normalisation

- Email addresses are trimmed and lowercased.
- Phone display values are trimmed and preserved for the UI.
- Duplicate checks use digits only and strip a leading `00`.
- Rwanda phone numbers are canonicalised:
  - `0XXXXXXXXX` becomes `250XXXXXXXXX`.
  - 9-digit `7XXXXXXXX` becomes `2507XXXXXXXX`.
- Search accepts local or international phone formats and matches on the trailing nine digits.
- Other countries keep the digit string after stripping formatting and `00`, provided it is 7–15
  digits.

## Duplicate detection

`find_customer_duplicates` returns up to five matches inside the selected business with match
reasons:

| Reason | Rule |
| --- | --- |
| `email` | Case-insensitive exact email match. |
| `phone` | Exact normalized phone match. |
| `name` | Case-insensitive exact full-name match. |

Rules:

- Email and phone matches block customer creation/update by default.
- Name-only matches are warnings and do not block saving.
- The current customer can be excluded while editing.
- Duplicate detection checks active business membership and never reads another business.
- The editor debounces checks by 350 ms and excludes the customer being edited.
- Owners, admins and managers can override a blocking email/phone match by supplying a 3–240
  character reason. Staff cannot override. Every override is recorded as a `duplicate_override`
  activity event.

## Roles and RLS

Every customer table requires an active membership in the business.

| Action | Owner | Admin | Manager | Staff |
| --- | --- | --- | --- | --- |
| Read customers, addresses, notes and activity | Yes | Yes | Yes | Yes |
| Create/update customers, notes and addresses | Yes | Yes | Yes | Yes |
| Override duplicate email/phone matches | Yes | Yes | Yes | No |
| Write customer, address, note or activity rows directly | No | No | No | No |

RLS grants authenticated active members select-only access. Direct insert/update/delete is denied
for all roles; writes go through security-definer RPCs that re-check authentication and active
membership. Client roles do not receive table write grants.

## RPCs

### `search_customers`

Returns customer profile rows with status, tags, the primary address, address count and filtered
total count. Supports search text, a single customer ID, status and tag filters, limit/offset, sort
field and direction. Search covers name, company, email, phone, normalized phone, tags and address
text. Limit is clamped to 1–100.

### `list_customer_tags`

Returns workspace tags and their customer counts, sorted alphabetically. Requires active business
membership.

### `find_customer_duplicates`

Returns matching customers and `match_reasons` for email, phone and name. Requires active business
membership and optionally excludes the current customer.

### `create_customer`

Requires any active business role. Validates name, email, phone, company, notes, status and tags;
normalizes contacts and tags; blocks duplicate email/phone unless an owner/admin/manager supplies an
override reason; inserts the profile, first note when provided, and activity events.

### `update_customer`

Requires any active business role. Locks the customer row, validates the full profile, blocks
duplicate email/phone against other customers unless an owner/admin/manager supplies an override
reason, records status/tag/contact changes as activity, and appends a note when `p_notes` is
provided. Passing `null` for status or tags preserves the current values.

### `add_customer_note`

Requires any active business role. Appends a 1–2,000 character note, records the author and adds a
`note_added` activity event. Notes cannot be edited or deleted through the client.

### `save_customer_address`

Requires any active business role. Validates address fields, defaults the country from the business,
and creates or updates an address. The first address becomes default. Marking an address default
clears the previous default. If no default exists after the write, the earliest address is promoted.

### `delete_customer_address`

Requires any active business role. Deletes the address. If the deleted address was default, the
earliest remaining address is promoted.

## UI routes

| Route | Purpose |
| --- | --- |
| `/customers` | Searchable, status/tag-filterable, sortable, paginated customer list. |
| `/customers/new` | Create a customer with contact validation, status/tags and duplicate checks. |
| `/customers/:customerId` | Contact details, tags, note history, activity and recent order history. |
| `/customers/:customerId/edit` | Edit the customer profile, status and tags. |

The customer list shows status, tags, contact methods, company, primary address and address count.
The editor shows blocking duplicate warnings and an override flow for owners, admins and managers.
The detail page manages addresses through an accessible dialog, supports appending notes and shows
the customer activity timeline plus the five most recent orders.

## Services and helpers

- `src/services/customerService.js` owns customer search, lookup, tag listing, notes/activity
  loading, duplicate detection, profile writes and address writes.
- `src/features/customers/customerUtils.js` owns status/sort options, event labels, tag parsing,
  form defaults, initials, address formatting and role checks.
- `CustomerServiceError` normalizes RLS, uniqueness, validation and missing-record errors.
- `src/features/customers/components/CustomerAddressDialog.jsx` owns the add/edit address dialog.

Components do not issue raw customer or address writes.

## Integration tests

Run:

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:customers
```

The script is `scripts/day6-customer-tests.mjs`. It uses the publishable key for real Auth and
PostgREST calls, and direct PostgreSQL access only for setup, verification and cleanup. No
service-role key is used.

Covered cases (219 checks):

1. Anonymous customer, address, note, activity, tag, search, duplicate and write access is denied.
2. Owner, manager and staff can create customers; non-members cannot.
3. Email is lowercased and phone digits are normalized while the display value is preserved.
4. Customers require at least one contact method; invalid email, phone and blank names are rejected.
5. Duplicate email and local/international phone formats are blocked per business.
6. The same contact details are allowed in a different business.
7. The same name is allowed with different contact details.
8. Status and tags are validated, normalized and filtered server-side.
9. Search matches name, company, email, local phone, tags and address text.
10. Search reports filtered totals, paginates and sorts by name, created and updated time.
11. Invalid sort/status filters and cross-business searches are rejected.
12. Tag listing returns sorted counts and is restricted to active members.
13. Active members can select customer and history rows directly; RLS hides other businesses.
14. Direct customer, address, note and activity inserts, updates and deletes are denied.
15. Duplicate detection matches email, phone and name case-insensitively.
16. Duplicate detection excludes the current customer and stays inside the business.
17. Customer updates preserve omitted status/tags and record status/tag/contact activity.
18. Customer updates save company/notes, append note history, record the editor and block duplicates.
19. Staff cannot override duplicate contacts; managers can with a valid reason.
20. Create and update duplicate overrides are recorded as activity events.
21. Updates cannot remove the last contact method.
22. Notes are append-only, validate length and record the author/activity event.
23. Staff can add, update and delete addresses; non-members cannot.
24. Address add/update/delete is recorded in the activity timeline.
25. The first address becomes default and the address country defaults to the business country.
26. Later addresses do not replace the default unless requested.
27. Marking a default clears the previous default and keeps exactly one default.
28. Address search and the primary-address aggregate work through customer search.
29. Invalid countries and missing address line 1 are rejected.
30. Addresses cannot be attached to a missing customer or another business.
31. Deleting a non-default address keeps the default; deleting the default promotes another.
32. The suite removes its test users, businesses, customers, addresses, notes and activity.

## Manual verification checklist

- [ ] Open `/customers` and confirm the empty state links to the create form.
- [ ] Create a customer with only an email, then one with only a phone.
- [ ] Set a status and comma-separated tags; confirm tags render lowercase and deduplicated.
- [ ] Filter the directory by status and tag; clear filters.
- [ ] Enter an email that already exists and confirm the submit is blocked for staff.
- [ ] As an owner/admin/manager, override the duplicate with a reason and confirm the activity event.
- [ ] Enter a matching name with different contact details and confirm it is only a warning.
- [ ] Search by name, company, email, local phone, tag and address.
- [ ] Change sort direction and move between pages.
- [ ] Add three addresses; confirm the first is default and only one address stays default.
- [ ] Edit an address and make it default; confirm the previous default is cleared.
- [ ] Delete the default address and confirm another is promoted.
- [ ] Add a note and confirm it appears newest-first and cannot be edited or deleted.
- [ ] Confirm the activity timeline shows creation, profile, status, tag, note and address events.
- [ ] Edit a customer and confirm self is excluded from duplicate detection.
- [ ] Confirm the order-history card shows linked orders.
- [ ] Confirm a second workspace cannot see the first workspace customers, history or activity.

## Known limitations

- No automated browser test runner is installed; UI behaviour is verified by lint/build, the
  integration suite and manual checks.
- Docker is unavailable in this environment. `supabase db push` succeeds but may print warnings
  about failing to cache the migration catalog through Docker.
- Search uses bounded `ilike` matching because `pg_trgm` is unavailable.
- Duplicate detection uses exact email/phone/name equality. It does not do fuzzy name matching.
- Notes are append-only; editing and deleting individual notes is not implemented.
- Customer merge, deletion and import/export are not implemented.
- Customer order history is provided by the Day 7 order module; customer merge, deletion and
  import/export remain future work.

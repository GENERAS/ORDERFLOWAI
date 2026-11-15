# Day 6 — Customer management

## Scope

Day 6 turns the Customers placeholder into a real multi-tenant customer module. It adds:

- Customer profiles with names, companies, email addresses, phone numbers and internal notes.
- Normalised contact storage and per-business duplicate protection.
- Duplicate detection before saving, with blocking contact matches and name-only warnings.
- A customer address book with labels, recipient details, default-address handling and country
  defaults.
- Server-side customer search, sorting and pagination.
- Customer list, create/edit form, customer detail and address dialog.
- Customer, address, duplicate and RLS integration tests.

Day 6 does **not** add orders, payments or AI workflows. The customer detail page shows an explicit
order-history placeholder; no order records are created or invented.

## Migration

| Migration | Purpose |
| --- | --- |
| `20261116010000_day6_customer_management.sql` | Customer and address tables, constraints, indexes, RLS, duplicate detection and RPCs. |

The migration has been applied to the linked Supabase project.

## Data model

| Table | Purpose |
| --- | --- |
| `customers` | One profile per customer in a business. |
| `customer_addresses` | Delivery/billing addresses owned by a customer. |

### `customers`

- `business_id`, `full_name`, optional `company_name`, `email`, `phone`, `notes`.
- `phone_normalized` stores the canonical digits used for duplicate checks.
- `created_by` and `updated_by` reference the acting auth user.
- `created_at` and `updated_at` are server-managed.
- Checks enforce a 1–160 character name, valid email shape, 7–32 character phone display value,
  7–15 normalized phone digits, notes up to 2,000 characters, and at least one contact method.
- A partial unique index on `(business_id, lower(email))` blocks duplicate emails per business.
- A partial unique index on `(business_id, phone_normalized)` blocks duplicate phone numbers per
  business.
- Name, created and updated indexes support search and sorting.

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

- Email and phone matches block customer creation/update.
- Name-only matches are warnings and do not block saving.
- The current customer can be excluded while editing.
- Duplicate detection checks active business membership and never reads another business.
- The editor debounces checks by 350 ms and excludes the customer being edited.

## Roles and RLS

Every customer table requires an active membership in the business.

| Action | Owner | Admin | Manager | Staff |
| --- | --- | --- | --- | --- |
| Read customers and addresses | Yes | Yes | Yes | Yes |
| Create/update customers | Yes | Yes | Yes | Yes |
| Add/update/delete addresses | Yes | Yes | Yes | Yes |
| Write customer/address rows directly | No | No | No | No |

RLS grants authenticated active members select-only access. Direct insert/update/delete is denied
for all roles; writes go through security-definer RPCs that re-check authentication and active
membership. Client roles do not receive table write grants.

## RPCs

### `search_customers`

Returns customer profile rows with the primary address, address count and filtered total count.
Supports search text, a single customer ID, limit/offset, sort field and direction. Search covers
name, company, email, phone, normalized phone and address text. Limit is clamped to 1–100.

### `find_customer_duplicates`

Returns matching customers and `match_reasons` for email, phone and name. Requires active business
membership and optionally excludes the current customer.

### `create_customer`

Requires any active business role. Validates name, email, phone, company and notes; normalizes
contacts; blocks duplicate email/phone; inserts the profile and records the creator.

### `update_customer`

Requires any active business role. Locks the customer row, validates the full profile, blocks
duplicate email/phone against other customers and records the editor.

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
| `/customers` | Searchable, sortable, paginated customer list. |
| `/customers/new` | Create a customer with contact validation and duplicate checks. |
| `/customers/:customerId` | Contact details, addresses, notes and order-history placeholder. |
| `/customers/:customerId/edit` | Edit the customer profile. |

The customer list shows contact methods, company, primary address and address count. The editor
shows blocking duplicate warnings before submit. The detail page manages addresses through an
accessible dialog and explains that order history is not available until the orders module is built.

## Services and helpers

- `src/services/customerService.js` owns customer search, lookup, duplicate detection, profile
  writes and address writes.
- `src/features/customers/customerUtils.js` owns sort options, form defaults, initials, address
  formatting and role checks.
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

Covered cases (136 checks):

1. Anonymous customer, address, search, duplicate and write access is denied.
2. Owner, manager and staff can create customers; non-members cannot.
3. Email is lowercased and phone digits are normalized while the display value is preserved.
4. Customers require at least one contact method; invalid email, phone and blank names are rejected.
5. Duplicate email and local/international phone formats are blocked per business.
6. The same contact details are allowed in a different business.
7. The same name is allowed with different contact details.
8. Search matches name, company, email, local phone and address text.
9. Search reports filtered totals, paginates and sorts by name, created and updated time.
10. Invalid sort options and cross-business searches are rejected.
11. Active members can select customer rows directly; RLS hides other businesses.
12. Direct customer and address inserts, updates and deletes are denied for all client roles.
13. Duplicate detection matches email, phone and name case-insensitively.
14. Duplicate detection excludes the current customer and stays inside the business.
15. Customer updates save company/notes, record the editor and block duplicate contacts.
16. Updates cannot remove the last contact method.
17. Staff can add, update and delete addresses; non-members cannot.
18. The first address becomes default and the address country defaults to the business country.
19. Later addresses do not replace the default unless requested.
20. Marking a default clears the previous default and keeps exactly one default.
21. Address search and the primary-address aggregate work through customer search.
22. Invalid countries and missing address line 1 are rejected.
23. Addresses cannot be attached to a missing customer or another business.
24. Deleting a non-default address keeps the default; deleting the default promotes another.
25. The suite removes its test users, businesses, customers and addresses.

## Manual verification checklist

- [ ] Open `/customers` and confirm the empty state links to the create form.
- [ ] Create a customer with only an email, then one with only a phone.
- [ ] Enter an email that already exists and confirm the submit is blocked.
- [ ] Enter a matching name with different contact details and confirm it is only a warning.
- [ ] Search by name, company, email, local phone and address.
- [ ] Change sort direction and move between pages.
- [ ] Add three addresses; confirm the first is default and only one address stays default.
- [ ] Edit an address and make it default; confirm the previous default is cleared.
- [ ] Delete the default address and confirm another is promoted.
- [ ] Edit a customer and confirm self is excluded from duplicate detection.
- [ ] Confirm the order-history card clearly states that orders are not built yet.
- [ ] Confirm a second workspace cannot see the first workspace customers or addresses.

## Known limitations

- No automated browser test runner is installed; UI behaviour is verified by lint/build, the
  integration suite and manual checks.
- Docker is unavailable in this environment. `supabase db push` succeeds but may print warnings
  about failing to cache the migration catalog through Docker.
- Search uses bounded `ilike` matching because `pg_trgm` is unavailable.
- Duplicate detection uses exact email/phone/name equality. It does not do fuzzy name matching.
- Customer merge, deletion, import/export and activity timelines are not implemented.
- Customer order history waits for the Day 7 orders module.

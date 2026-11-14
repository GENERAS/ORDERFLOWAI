# Day 3 — Authentication, onboarding and workspace selection

## Scope

Day 3 connects Supabase Auth to the existing OrderFlow AI shell. It adds:

- Email/password registration, confirmation, login, logout and password recovery.
- A single auth provider that owns the session, profile, memberships and active workspace.
- Protected routing for authenticated users and for users with an active workspace.
- Business onboarding through the existing `create_business` RPC.
- Multi-workspace selection and switching.
- Auth/RLS integration tests, reusable form controls and normalized error messages.

Day 3 does **not** add product, order, payment, inventory or AI workflows. Those modules
remain placeholders.

## Routes and guards

| Route | Guard | Behaviour |
| --- | --- | --- |
| `/login` | Public | Redirects authenticated users to their post-auth destination. |
| `/register` | Public | Creates an account and sends a confirmation email. |
| `/verify-email` | Public | Resends the signup confirmation email. |
| `/forgot-password` | Public | Sends a password recovery email. |
| `/reset-password` | Public | Accepts a recovery session or link and updates the password. |
| `/auth/callback` | Public | Completes email confirmation and stores the session. |
| `/onboarding` | `RequireAuth` | Creates the user's first business workspace. |
| `/workspaces` | `RequireAuth` | Selects one of multiple active workspaces. |
| `/overview`, `/inbox`, `/orders`, `/products`, `/inventory`, `/customers`, `/payments`, `/reports`, `/team`, `/settings` | `RequireWorkspace` + `AppLayout` | Protected application screens. |
| `/` | `RootRedirect` | Routes by auth and membership state. |
| Any unknown protected path | Protected 404 | Rendered inside the application shell. |

The guards are a user-experience layer. They do not replace database authorization. Every
tenant-owned table is still protected by Row Level Security.

### Post-auth routing

`getPostAuthPath` implements the routing rules:

```text
no active memberships        -> /onboarding
multiple memberships, none   -> /workspaces
one membership or a valid    -> /overview
selection
```

A stored workspace selection is used only if it still matches an active membership. Suspended
or removed memberships cannot be selected.

`getSafeDestination` accepts only internal paths. A `next` or `from` value that starts with
`//` or an external URL is rejected.

## Auth lifecycle

`src/features/auth/AuthProvider.jsx` is the only auth listener in the application.

1. On mount, it checks whether Supabase is configured.
2. It calls `auth.getSession()` and loads the profile plus active memberships in parallel.
3. It subscribes to `onAuthStateChange`:
   - `SIGNED_IN`, `USER_UPDATED` and `PASSWORD_RECOVERY` reload workspace data.
   - `TOKEN_REFRESHED` updates the session without reloading memberships.
   - `SIGNED_OUT` clears the session, memberships and stored active workspace.
4. On focus or visibility change, it calls `auth.getUser()` and refreshes memberships at most
   once every 30 seconds. This removes access after a membership is suspended server-side.
5. `signOut` clears local state even if the network request fails.

Exposed provider values include:

- `status`: `loading`, `authenticated`, `unauthenticated` or `error`
- `user`, `session`, `profile`
- `memberships`, `activeBusiness`, `activeMembership`, `activeBusinessId`
- `refreshMemberships`, `selectBusiness`, `signOut`, `retry`

The active workspace ID is stored under `orderflow.activeBusinessId`. If storage is
unavailable, selection still works for the current tab.

## Membership loading

`fetchMemberships` uses two queries instead of an embedded join:

1. Select the user's `active` rows from `business_members`.
2. Select the related businesses with `.in('id', businessIds)`.

Memberships whose business row cannot be read are dropped. This avoids depending on
PostgREST relationship metadata and keeps the membership payload explicit.

## Registration and email confirmation

- The registration form validates full name, email, password and confirmation.
- `signUp` passes `full_name` in user metadata and a callback URL of `/auth/callback`.
- When email confirmations are enabled, the user is unconfirmed and has no session until the
  link is used.
- `/verify-email` resends the confirmation email without exposing whether an account exists.
- `/auth/callback` handles both PKCE `code` and token-hash callback forms, then sends the user
  to their post-auth destination.
- An expired or invalid callback link shows a recovery action instead of a fake success state.

## Password recovery

- `/forgot-password` calls `resetPasswordForEmail` with a redirect to `/reset-password`.
- `/reset-password` accepts a recovery session or verifies a recovery token, then calls
  `auth.updateUser({ password })`.
- Invalid or expired links show a clear message and a link to request a new email.
- After a successful update, the old password no longer works.

## Onboarding

`src/features/onboarding/OnboardingPage.jsx` collects:

- Business name (required, up to 160 characters)
- Industry (optional)
- Country (required)
- Currency (required)
- Timezone (required, defaults to the browser timezone)

The workspace slug is generated from the name plus a suffix that stays stable for the current
form session. The client validates the name and slug, then calls `create_business` with the
business fields only. The RPC derives the owner from `auth.uid()` and atomically creates the
business and owner membership.

If the slug is already taken:

- A submit lock prevents double-clicks.
- The RPC raises a unique violation (`23505`).
- The page refreshes memberships and opens the existing workspace if it belongs to the user.
- Otherwise it asks the user to change the business name and generates a new suffix.

The browser never inserts business rows or owner memberships directly.

## Multi-workspace behaviour

- Exactly one active membership is selected automatically.
- Multiple memberships with no valid stored selection route to `/workspaces`.
- The workspace picker shows business name, role and slug.
- The header account menu and sidebar expose workspace switching.
- Selecting a workspace updates the provider and persisted selection.
- `RequireWorkspace` redirects users with no workspace to `/onboarding`.

## Error handling

`src/services/authService.js` normalizes Supabase Auth, PostgREST and network errors into
`AuthServiceError`. Covered cases include:

- invalid credentials
- unconfirmed email
- duplicate account
- weak, short or unchanged password
- expired or invalid confirmation/recovery links
- email and request rate limits
- missing or expired sessions
- permission and RLS failures
- duplicate workspace slug (`23505`)
- network failures

Raw provider errors are not shown as the primary user-facing message.

## Required Supabase Auth configuration

Remote and local configuration must allow the app routes.

Remote linked project:

- Site URL: `http://localhost:5173`
- Redirect allow list: `http://localhost:5173/**`, `http://127.0.0.1:5173/**`
- Email confirmations: enabled
- Email provider: enabled
- Secure password change: enabled
- Built-in mailer: email sending limited to two messages per hour

Local `supabase/config.toml`:

- `site_url = "http://localhost:5173"`
- `additional_redirect_urls` includes `/auth/callback` and `/reset-password` for both
  `localhost` and `127.0.0.1`
- `enable_confirmations = true`
- `secure_password_change = true`

For production, add the deployed origin and the same callback/reset paths to the Supabase
Auth URL configuration.

## Integration tests

Run:

```powershell
. .\scripts\load-supabase-db-password.ps1
npm run test:auth
```

The script is `scripts/day3-auth-tests.mjs`. It uses:

- the publishable/anon key for real Auth and PostgREST calls
- direct PostgreSQL access only for test setup, email confirmation, membership suspension and
  cleanup
- no service-role key in the browser or test script

Covered cases:

1. Registration and email-confirmation gating
2. Duplicate registration handling
3. Valid and invalid login
4. Logout
5. Password recovery request and invalid token rejection
6. Authenticated password update and old-password invalidation
7. Persisted session restoration
8. Unauthenticated business read/create denial
9. Onboarding through `create_business`
10. Single-workspace and multi-workspace routing
11. User with no workspace
12. Suspended membership losing access
13. Duplicate onboarding rejection and no duplicate rows
14. Cross-tenant read/update denial
15. Cross-tenant membership and profile denial

At the time of the Day 3 test run, the project email limit was exhausted. The suite reported
49 passing checks and 3 skipped live-email checks. The skipped paths were covered as follows:

- Registration gating was verified with an unconfirmed user created directly for the test.
- Invalid recovery-token handling and authenticated password updates still ran.
- Live signup, duplicate-signup and password-reset email delivery must be manually verified
  when the two-per-hour limit resets.

The test creates unique `day3-test-*` users and `day3-*` workspaces, then deletes them in a
`finally` block.

## Manual verification checklist

Use a fresh test account and an accessible inbox:

- [ ] Register and receive the confirmation email.
- [ ] Open the confirmation link and reach onboarding.
- [ ] Sign in before confirmation and see the confirmation message.
- [ ] Complete onboarding and land on `/overview`.
- [ ] Reload the page and remain signed in.
- [ ] Request a password reset and open the recovery link.
- [ ] Set a new password and confirm the old password fails.
- [ ] Sign out from the header.
- [ ] Sign in with a second workspace and use the workspace switcher.
- [ ] Confirm a suspended membership disappears after focus revalidation or reload.
- [ ] Confirm an unauthorized workspace cannot be read through the UI.

## Known limitations

- No automated browser test runner is installed; route-guard and form behaviour are verified
  by lint/build and manual checks.
- Email inbox access is not available in the test environment. Built-in mailer delivery and
  click-through require manual verification.
- The built-in mailer's two-email-per-hour limit can make repeated auth tests flaky. The suite
  falls back to direct database setup and records the skipped live-email checks.
- Team invitations, role management and workspace settings remain later-phase work.

# Authentication (Login)

```
status: planned
```

## Purpose

Secure access to the Keystone HR Men Salon Management System using registered credentials. Both English and Arabic (RTL) versions of the login screen exist.

## Primary users / permissions

All system users (any role). Post-login authorization is RBAC + branch scoping (see dashboard.md, settings.md).

## Screen elements & fields

1. **Keystone HR logo** — branding; no click action (unless configured to redirect to home).
2. **Welcome message** — title "Welcome Back!", description "Sign in to continue to your account."
3. **Email / Username field**
   - Label: "Email or Username"; placeholder: "Enter your email or username"
   - Validation: cannot be empty; must match an existing user account
4. **Password field**
   - Label: "Password"; placeholder: "Enter your password"
   - Validation: cannot be empty; characters masked; must match the stored password for the entered account
5. **Forgot Password link** — label "Forgot Password?"
6. **Sign In button** — label "Sign In". Action: validates required fields → sends credentials to authentication service → verifies user account status and permissions → grants access on success.

## Flows

### Successful login
Open login screen → enter email/username → enter password → click Sign In → validate credentials → authentication successful → **redirect to Dashboard**.

### Invalid credentials
Click Sign In → authentication failed → display error "Invalid email/username or password" → user tries again.

### Forgot-password flow
1. User clicks Forgot Password
2. Password Recovery screen
3. User enters registered email
4. System sends reset link / OTP ("password reset instructions are sent")
5. User resets password
6. Return to login screen
7. Login with new password

## Error messages (exact copy)

| Condition | Message |
|---|---|
| Email/Username empty | Please enter your email or username |
| Password empty | Please enter your password |
| Invalid credentials | Invalid email/username or password |
| Account inactive | Your account is inactive. Please contact administrator |
| Network issue | Unable to connect. Please try again later |

(Localize all five in Arabic; error-code enum in `packages/shared` maps codes to localized messages in web.)

## Account states

- **Active** — can log in.
- **Inactive** — login blocked with the "account is inactive" message (staff statuses Inactive/Suspended/Resigned/Terminated should all block login; see staff.md).
- Account status is verified during Sign In along with permissions.

## Business rules / implementation notes (design-app.md §3, §7)

- Passwords hashed with **argon2id** (`users.password_hash`); self-managed JWT.
- JWT claims: `{ sub, tenantId, roleId, branchIds: string[] | '*' }`; refresh tokens stored hashed in `refresh_tokens` (expires_at, revoked_at, device_info) with token pruning job.
- Web: login POSTs to a Next.js route handler → API → sets httpOnly Secure SameSite=Lax cookies; browser never holds raw tokens; proxy attaches Bearer; refresh-on-401 retried once. `middleware.ts` guards dashboard routes by cookie presence; real authz is the API's job.
- Username OR email accepted as identifier (both unique per tenant).
- Reset Password can also be triggered by an admin from Staff list (More Actions → Reset Password).

## Data-model touchpoints

`users` (email/username unique per tenant, password_hash argon2id, status, locale, last_login_at, all_branches), `refresh_tokens`, `roles` + `role_permissions`, `user_branch_assignments`, `audit_logs` (login/security events).

## Future: invite signup & social sign-in (design note, 2026-07)

Both fit the current architecture without rework: auth is self-managed JWT issuance
behind the BFF, so any new identity proof just becomes another way to mint the same
access/refresh pair — guards, CLS, RLS, refresh rotation and cookie handling are
untouched. Decisions and additions when these land:

**Invite signup** (unblocks at Phase 6 — needs SES email delivery; Mailpit covers dev):
- `user_invitations` table mirroring the `password_reset_tokens` pattern:
  `tenant_id, email, role_id, all_branches/branch_ids, token_hash UNIQUE, expires_at,
  accepted_at, invited_by` + standard RLS block.
- `POST /users/invite` (`users.manage`) alongside the existing create-user; public
  accept endpoint (like reset-password) where the invitee sets name + password, then
  the existing user-creation logic runs. Admin-set-password flow stays as fallback.

**Social sign-in (Google/Apple/Microsoft)** — for *already-provisioned* staff
("sign in with Google", linked on first use), NOT open self-signup; provisioning
stays invite/admin-driven:
- Expand-only schema: `users.password_hash` → nullable (social-only users);
  new `user_identities` table `(tenant_id, user_id, provider,
  provider_user_id — unique per provider, email)` + RLS.
- OAuth callback (BFF route) verifies the provider token → API mints the normal
  token pair. Link identities by verified email within the tenant on first sign-in.
- **Blocker to decide first — tenant resolution**: provider returns an email, but
  email is unique per TENANT, so the tenant must be known before redirecting to the
  provider. Options: tenant-scoped login URLs using the existing `Tenant.slug`
  (`/t/{slug}/login` or subdomain — recommended) or a tenant-chooser step. NOTE:
  the same ambiguity exists today in password login (cross-tenant `findFirst` on
  email) — it only works because emails don't collide across tenants yet; fix both
  paths with the same decision.

## Open questions

- Reset mechanism: link vs OTP — PDF says "Send Reset Link / OTP"; pick one (email link recommended given SES) and spec the token lifetime.
- Lockout/rate-limiting policy after repeated failed attempts — not in PDF; define.
- Password minimum security requirements (referenced in staff System Access) — exact policy undefined. (The web/user-management slice shipped a pragmatic default: min 8, max 72, ≥1 letter + ≥1 digit — `PasswordSchema` in `packages/shared/src/schemas/user.ts`; ratify or revise.)
- Session duration / refresh-token TTL and "remember me" — undefined.
- Tenant resolution for login when one email exists in multiple tenants (see design note above) — slug-scoped login vs tenant chooser.

## Reconciliation vs 2026 client requirement doc

- Reviewed against the 2026 req (LOGIN section) — matches item-for-item: same screen fields, the 3 flows (successful login, invalid credentials, forgot-password), and the 5 exact error messages.
- This doc is a **superset** of the req: it adds argon2id hashing, self-managed JWT + refresh rotation, and BFF/cookie handling that the req does not mention. No changes required.
- The reset-mechanism ambiguity (reset **link** vs **OTP**) is still unresolved in the 2026 req — remains an open question above.

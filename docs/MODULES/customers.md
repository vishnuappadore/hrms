# Customers

```
status: built (2026 req) — API `/customers` + web screens
```

> **Resolved open questions (build, 2026-08-01):**
> - **Add-customer** is single-step; duplicate mobile is blocked at the DB (`UNIQUE(tenant_id, mobile)`) + `assertMobileFree` → `CUSTOMER_MOBILE_EXISTS`, and the form surfaces a "View existing customer" link (reuses the list's mobile search).
> - **Loyalty tier** is a stored, directly-editable field (`CUSTOMER_TIERS`, default `new`), distinct from the Loyalty module's `LOYALTY_TIERS` — unify when Loyalty (Phase 5) lands.
> - **Visits / Points / Total Spend** are stored counters (default 0), system-maintained; POS/Appointments/Loyalty will increment them. `points` reconciles to `loyalty_accounts` when Loyalty lands.
> - **Appointment History** is a UI empty-state until [[appointments]] exists.
> - **Out of scope** (de-scoped in the 2026 req): status/soft-delete, branch-scoping, KPI cards, export/import, wallet/memberships, multi-tab profile, rich personal fields, SMS/call. Email is optional, but both mobile and email are unique per tenant when provided (`CUSTOMER_MOBILE_EXISTS` / `CUSTOMER_EMAIL_EXISTS`).
> - ⚠️ Latent cross-module gap: the Dashboard "Active Member" KPI ([[dashboard]]) references inactive/blocked states this module no longer models — resolve in the Dashboard phase.

## Purpose

Centralized master repository for customer information, loyalty tier/status, visit history, and spending analytics. Salon staff create and maintain customer records, search/filter them, review a profile, and launch operational activities (Book Appointment, New Sale) from a customer. The Customers module is the **master data source** for customer identity; records created through any operational module (Appointment, Walk-in Queue, POS) are maintained and accessible here. Bilingual EN + AR (RTL); currency OMR with 3 decimals (baisa).

## Primary users / permissions

Receptionists, Branch Managers, Operations/Management, Super Admin. (The 2026 req does not restate branch-scoped visibility or a delete permission — see Open questions.)

## Screens & flows

Module navigation: `Customer List` → `Add Customer` / `Customer Profile` (View) / `Edit Customer` / `Book Appointment` / `New Sale`. Add/Edit/View are one slide-in drawer, not three screens.

### 1. Customers Dashboard (Customer List)

Displays all registered customers with contact info, loyalty tier, visit statistics, loyalty points, and spending history. Sections: Customer Search, Loyalty Tier Filters, Customer List, Customer Actions, Add Customer.

- **Search** — a single search field over **Customer Name** and **Mobile Number** only. Filters the list dynamically as the user types.
- **Loyalty Tier filter** — a pill-row (`SegmentedControl`, same shape as the drawer's own tier picker): `All`, `New`, `Bronze`, `Silver`, `Gold`, `Platinum`. Selecting a tier shows only customers at that tier.
- **Action button** — `+ Add Customer` (opens the drawer in create mode; gated on `customers.create`).
- **Data grid columns**
  1. **Customer** — Customer Avatar (initials) + Customer Name
  2. **Contact** — Mobile Number + Email Address
  3. **Tier** — a colored badge (platinum=purple, gold=amber, silver=gray, bronze=copper, new=blue), not plain text
  4. **Visits** — total number of completed salon visits
  5. **Points** — current loyalty point balance
  6. **Total Spend** — cumulative spend across all completed transactions (money = minor units; render OMR to 3 decimals)
  7. **Actions** — three icon buttons: `View` (eye, opens the drawer in view mode, always visible), `Sell` (cart, links to POS with the customer pre-selected, only when `pos.use`), `Edit` (pencil, opens the drawer in edit mode, only when `customers.update`)

No Customer-ID column, no Status column, no Branch/Preferred-Branch column, no Delete action, no Export/Import buttons in the 2026 grid (see Open questions).

### 2. Add Customer — single step, in a slide-in drawer

`+ Add Customer` opens a slide-in `Drawer` from the trailing edge of the screen (not a separate page) — the
same drawer also handles Edit and View (see below), switching modes without closing/reopening. Flow: List →
Add Customer → enter info → Save → customer created → drawer closes → list refreshes. Once created the
customer is available throughout the application.

**Fields**
1. **Mobile Number*** — mandatory; a country-code `<Select>` (e.g. "+968 Oman") beside a digits-only local
   number input, composed into one E.164-ish value on submit. The country defaults from the tenant's
   currency (a small local lookup, pure UX — not a stored tenant field) and, when editing, from the
   existing number's own dial code. Validation stays the shared, country-agnostic `MobileSchema` regex —
   the picker is a convenience, not a new per-country format rule (see `docs/GLOBALIZATION.md`).
2. **Full Name*** — mandatory, 2+ characters
3. **Email** — optional, unique per tenant when provided
4. **Loyalty Tier** — a pill-row (`SegmentedControl`) defaulting to `New`; may be explicitly set to another tier at creation (the req lists "Email (By Default New)" which is a doc typo for the default-tier assignment — see business rules)

On Save: system validates, prevents duplicates on mobile number and (now) email, creates the record. No two-step "verify first" flow, no verify-then-branch UX — duplicate prevention is a plain uniqueness check on save. (The prior two-step mobile-dedupe wizard with an "Existing Customer Found" branch is removed — see ⚠️ Changed.)

### 3. Customer Profile (View)

`View` (the list's eye icon) opens the same slide-in drawer as Add/Edit, in a read-only "view" mode: a
summary of the customer's relationship with the salon, loyalty information, and appointment history. There
is **one** consolidated layout (no tabs), shared with the standalone `/customers/:id` page (a direct deep
link to the same content, outside the drawer) via one `CustomerDetailView` component. Tier renders as a
colored badge (platinum=purple, gold=amber, silver=gray, bronze=copper, new=blue) rather than plain text.

**Summary section**
- Customer Avatar — customer's initials
- Customer Name — full name
- Loyalty Tier — current membership level
- Mobile Number — registered contact number
- Email Address — registered email

**Customer Statistics**
- Visits — total completed visits
- Loyalty Points — current available points
- Total Spend — total lifetime spending
- Customer Since — date the customer first registered

**Appointment History** — list of the customer's previous appointments. (The req does not enumerate columns/filters for this list here — treat detailed appointment fields/filters as owned by [[appointments]].)

**Profile actions**
- **Edit** — switches the same open drawer into edit mode (no close/reopen); from the standalone page it opens the drawer
- **Book Appointment** — styled as a primary (colored) button but still disabled with a "coming soon" tooltip until [[appointments]] supports a customer-prefill entry point (unlike New Sale, this hasn't been wired up yet)
- **New Sale** — a real link to `/pos?customerId=<id>`, pre-selecting the customer in POS's cart (gated on `pos.use`); cashier may add services, add products, redeem loyalty points, complete payment

### 4. Edit Customer

Opens the customer in edit mode, in the same slide-in drawer as Add/View (not a separate page). Editable
fields (only these four, same as Add — see field details in section 2):
1. Name
2. Mobile Number (country-code picker + local number)
3. Email
4. **Loyalty Tier** — directly editable field (pill-row, not a dropdown)

Changes are reflected immediately across all modules that reference the customer.

## Data model / fields

`customers` table (tenant table — `tenant_id` + RLS ENABLE & FORCE + `tenant_isolation` policy):

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | RLS scope |
| `mobile` | text | required; `UNIQUE(tenant_id, mobile)` |
| `name` | text | required (Full Name) |
| `email` | text | optional |
| `loyalty_tier` | enum | `New` \| `Bronze` \| `Silver` \| `Gold` \| `Platinum`; default `New`; directly editable |
| `created_at` | timestamptz | drives "Customer Since" |

**Derived / read-only statistics** (computed from completed transactions, not stored as authoritative editable fields): Visits (count of completed visits), Total Spend (sum of completed transactions, minor units), Loyalty Points (current balance, sourced from [[loyalty]]).

The req does not model an avatar image — the avatar is rendered from the customer's initials.

## Business rules

- **Mobile is the unique key**: each customer is uniquely identified by mobile number → `UNIQUE(tenant_id, mobile)`. The system prevents duplicate records with the same mobile.
- **Mandatory on create**: Name and Mobile Number.
- **Default tier**: newly created customers get the `New` loyalty tier unless another tier is explicitly selected.
- **Statistics are automatic**: Visits, Total Spend, and Loyalty Points are calculated automatically from completed transactions and update after each completed transaction.
- **Cross-module propagation**: Booking an appointment or creating a sale from the profile auto-populates customer details in [[appointments]] / [[pos]]. Edits to customer info reflect immediately across all referencing modules.
- **One unified profile** per customer, accessible regardless of which operational module created the record.

## Status / state machines

**Loyalty tier ladder**: `New → Bronze → Silver → Gold → Platinum`. Default = `New`. In this module the tier is a **directly-editable field** (set at create, changeable in Edit). The req names Loyalty as a separate module but gives it no standalone spec in this section, so the earn/redeem/tier-progression mechanics are NOT defined here — see [[loyalty]]. No customer Active/Inactive status is defined in the 2026 req (the prior Active/Inactive status is dropped — see Open questions).

## Integrations

The Customers module is the master customer-data source. It integrates with:
- [[appointments]] — Book Appointment pre-fills the customer; appointment history feeds the profile and Visits.
- Walk-in Queue — customers created via the queue are maintained here.
- [[pos]] / Checkout — New Sale loads the customer; completed sales update Visits, Total Spend, and Points.
- [[loyalty]] — owns points balances, tier mechanics, and redemption; this module only displays tier/points and lets staff set the tier field.

## Engineering notes (invariants)

- **Tenant isolation / RLS**: `customers` is a tenant table — `tenant_id` + RLS (ENABLE **and** FORCE) + `tenant_isolation` policy, added in the same migration that creates the table (`apps/api/prisma/rls.sql` pattern). Runtime connects as `hayryou_app`; all access via `PrismaService.client` / `withTenantTx()`.
- **Money**: Total Spend and any monetary value are integer minor units + ISO 4217 currency (OMR exponent 3). All arithmetic via `packages/shared/src/money.ts`; never floats. Currency flows tenant default → branch → financial rows.
- **API contract**: zod schema in `packages/shared` (create/update customer, tier enum) → `createZodDto` in the API → same schema in web forms. Name requires 2+ characters (`.trim().min(2)`). Duplicate mobile or email return stable `ERROR_CODES` (`CUSTOMER_MOBILE_EXISTS` / `CUSTOMER_EMAIL_EXISTS`, each a plain unique index per tenant — nullable, so multiple customers with no email is fine); clients match on `code`, not message text.
- **Permissions**: `customers.view`/`customers.create`/`customers.update` — a clean 1:1 mapping between the catalog and every endpoint, no orphaned keys (unlike some other modules' `.delete`/`.export` keys, which exist in the catalog but have no endpoint). Client-side: the eye (View) icon is always shown once the list itself loaded, Sell requires `pos.use`, Edit requires `customers.update`, Add requires `customers.create` — see `docs/RBAC.md`'s client-side enforcement section. (Branch scoping via `getEffectiveBranchIds()` was assumed in v1 but is not restated in the 2026 req — see Open questions.)
- **RTL**: Tailwind logical properties only; grid, search, and profile checked in Arabic.
- **Migrations**: expand → migrate → contract for any tier-enum or column changes.

## ⚠️ Changed in this revision

- **Loyalty tier ladder gained a `New` tier** → `New / Bronze / Silver / Gold / Platinum`, with **default = New**. Prior doc had only Bronze/Silver/Gold/Platinum ("Membership Type") and no default.
- **Loyalty Tier is now a directly-editable field** on create and in Edit (prior doc treated membership as derived/loyalty-owned only).
- **Add Customer is a single step** with just Mobile, Full Name, Email(optional), Tier(default New). The prior **two-step, verify-first mobile-dedupe wizard** (Step 1 Verify → "Existing Customer Found" banner with KPI cards / Scenario 2 details form incl. Customer Type, Referred By, Notes) is **removed**; duplicate prevention is now a plain uniqueness check on save.
- **Grid columns simplified** to Customer / Contact / Tier / Visits / Points / Total Spend / Actions. Dropped from the grid: Customer ID, Status, Preferred Branch, Last Visit Date, and the separate Profile-Image column (avatar now = initials).
- **Grid actions** are now `View / New Sale / Edit`. **Delete removed** from row actions; **Export / Import buttons removed** from the dashboard.
- **Search narrowed** to Name + Mobile only (prior: Name, Mobile, Customer ID, Email).
- **Loyalty Tier filter** replaces the old Branch / Membership / Status filter set; `New` added as a filter value.
- **Profile collapsed from 5 tabs to one page**: Summary + Statistics + Appointment History. The Personal Information, Services, Transactions, and Loyalty Dashboard tabs are gone from this spec.
- **Edit scope narrowed** to Name, Mobile, Email, Loyalty Tier only.

## ❓ Open questions / needs client confirmation

Everything below was **previously specced; not present in the 2026 client doc — confirm DE-SCOPED vs DEFERRED** (do not assume removal):

- **Customer Active/Inactive status + soft delete** (`deleted_at`, exclusion from Active counts). No status/delete appears in the 2026 req.
- **Wallet** (Top-Up / Deposit transaction types) and the Transactions tab entirely.
- **Memberships / packages** ("Membership Purchase") and the Loyalty Dashboard tab (points history / redemptions / earn rules) — now referenced only via [[loyalty]].
- **Services tab** (per-service visit history, preferred staff, upsell view).
- **Rich personal-info fields**: Date of Birth, Alternate Number, Gender, Marital Status, Nationality, Preferred Language, ID Type/Number, Preferred Communication, Referral Source / Referred By, Special Occasions, Customer Type (Walk-In/Online), Notes.
- **Import / Export customer list** (and import file format + dedupe-on-import behavior).
- **Send SMS / Call Customer** profile actions.
- **Preferred branch + branch-scoped visibility** (`getEffectiveBranchIds()`), and any per-branch customer filtering.
- **Referral capture** ("Referred By" search) and the two-step dedupe "Existing Customer Found" UX.
- **Customer ID** as a user-visible identifier (grid/search/profile).

Genuinely ambiguous in the 2026 req (needs a decision regardless of scope):
- **Duplicate-on-save behavior**: block with an error toast vs. surface the existing customer? The two-step verify flow that used to handle this is gone.
- **Appointment History contents**: columns, filters, date range, and per-row actions are not enumerated in this section — confirm they inherit from [[appointments]].
- **"Email (By Default New)"** in the field list reads as a doc typo for the default loyalty-tier assignment; confirm the Loyalty Tier field is what appears in Add Customer.

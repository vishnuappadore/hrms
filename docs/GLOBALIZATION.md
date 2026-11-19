# Globalization — building beyond Oman/GCC

> One-line summary: The launch market is Oman, but nothing in the codebase may hard-code it. This doc lists every geography-sensitive axis, what's already neutral, and the rules new code must follow.

`status:` conventions BUILT into the foundation; per-axis expansion work PLANNED (triggered by the first non-GCC tenant, not before).

## The rule

**Oman is a default, never an assumption.** Anything market-specific must be (in priority order): a tenant/branch setting → a config/lookup table → a shared-package constant. Never an inline literal in feature code.

## Axis by axis

### 1. Currency — BUILT
- Money = integer minor units + ISO 4217 code; per-currency exponent in `CURRENCY_EXPONENTS` (`packages/shared/src/money.ts`). OMR=3, USD/SAR/AED=2, JPY=0. Adding a currency = one line there.
- Defaults flow `tenant.default_currency` → `branch.currency` → stamped on every financial row.
- **Deferred:** cross-currency consolidated reporting (a tenant with branches in OMR and AED needs an exchange-rate table + conversion policy before tenant-wide revenue KPIs can sum across them). Until then a tenant's branches should share one currency; enforce in branch creation UI copy, not schema.

### 2. Tax — BUILT (component math + DB-configured profiles)
- Generic naming: `tax_applicable` / `tax_rate_percent` per branch (NOT "vat_") — reads correctly for VAT (GCC), GST (India), sales tax (US). UI copy may still say "VAT" for GCC tenants — that's a translation string, not a column name.
- **Tax is a list of named components, not a single rate.** `computeInvoiceTotals` (packages/shared) accepts `taxComponents: [{name, ratePercent}]`; each component is computed on the same taxable base and **rounded independently** (matches GST invoice practice — note CGST 9% + SGST 9% can differ by a minor unit from IGST 18%, and that's correct). Single-rate systems are a one-component list; the GCC `taxRatePercent` shorthand still works.
  - GCC: `[{VAT: 5}]` · India intra-state: `[{CGST: 9}, {SGST: 9}]` · India inter-state: `[{IGST: 18}]` · Canada: `[{GST: 5}, {PST: 7}]`
  - Compound ("tax on tax") is deliberately NOT supported — add an explicit `compoundOn` field if a market requires it; never silently cascade.
- **DB configuration (BUILT — single source for POS calculation, billing, bill display, reports):**
  - `tax_profiles` (tenant-scoped): name, country, `is_default` — e.g. "Oman VAT", "India GST 18%". Seeded at tenant provisioning (`TenantsService.provisionTenant` takes market defaults).
  - `tax_components`: profile_id, name ("CGST"), rate `numeric(5,2)`, sort_order
  - `branches.tax_profile_id` → profile (omitted at creation → tenant default; null → tax-free branch)
  - API: `GET/POST/PATCH /tax-profiles` (`taxes.view` / `taxes.manage`); consumers call `TaxesService.getComponentsForBranch(branchId)` and feed the result to `computeInvoiceTotals` — **never a literal rate in feature code**
  - PLANNED: `invoices.tax_breakdown JSONB` persists the computed `TaxLine[]` at sale time — invoices must show what was charged even if the profile is edited later (which is also why profile edits never rewrite history)
- **Per-country selection rules** (e.g. India's place-of-supply: intra-state → CGST+SGST, inter-state → IGST) are a resolver in the API that picks WHICH profile applies to a sale — implemented per market at launch time. Item-level rates / HSN-SAC codes (full India GST compliance) are a further extension: move components from invoice level to line level; the math helpers already work per-line.

### 3. Language & script — BUILT
- next-intl with `[locale]` routing; adding a locale = new `messages/<locale>.json` + one entry in `routing.ts`. RTL is handled via `dir` + logical Tailwind properties (enforced by lint), so LTR locales need zero layout work.
- DB pattern for bilingual entity names is `name_en`/`name_ar` columns. **This is the one GCC-shaped compromise** (chosen because the client's own data is bilingual). If a third content language ever becomes real, migrate to a `name JSONB {locale: value}` pattern — flag this in review if you're adding many new `_en/_ar` columns.

### 4. Time & calendars — BUILT
- `tenant.timezone` (IANA name) drives all business-day boundaries ("Revenue Today" starts at tenant-local midnight — never server midnight, never UTC). Branch-level timezone override only when a tenant actually spans zones (schema change is additive).
- Weekly off day is a branch setting (Friday in GCC, Sunday elsewhere) — already a field, never assume.
- Gregorian calendar in data; Hijri display (if ever requested) is an Intl formatting concern at the display edge.

### 5. Phone, address, ID documents — BUILT / config
- Phones: E.164-ish validation, no country-code assumption (`MobileSchema`).
- Addresses: free-text + country/state/city strings — deliberately loose; do not add Oman-specific structure.
- Customer ID types (Oman ID / Passport / …): must be a per-tenant configurable lookup when the customers module lands — NOT a hard-coded enum.

### 6. Messaging providers — adapter pattern (planned with notifications module)
- `NotificationChannel` interface with provider adapters. Unifonic fits GCC; other markets swap adapters (Twilio, MSG91, …) per tenant/region — a config choice, not a code fork. Sender-ID/WhatsApp-template registration is per-country paperwork; track lead times per market.

### 7. Payment methods — data, not code
- `mada` in the `PAYMENT_METHODS` enum is GCC-specific. When expanding, treat available payment methods as per-branch configuration filtered from the global enum; POS renders what the branch enables.

### 8. Infra & data residency — BUILT (variable)
- Region is a Terraform variable (me-central-1 default). A new market with residency requirements = new env directory with a different region — modules are region-agnostic. Multi-region active-active is explicitly out of scope until a business case exists.

## Checklist for new code (add to PR review)
- [ ] No inline currency codes, tax rates, country names, or locale literals — pull from tenant/branch settings or shared constants
- [ ] Money math through `packages/shared` helpers with an explicit currency
- [ ] User-facing strings through i18n messages (both locales)
- [ ] Date logic through the tenant timezone, never server-local
- [ ] New enums that are actually market-dependent (ID types, payment methods, referral sources) → per-tenant config instead

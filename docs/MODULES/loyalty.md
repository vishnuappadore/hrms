# Loyalty

```
status: planned
```

## Purpose

Points-based loyalty program with membership tiers. Customers earn points on spend, redeem them as discounts at POS and appointment booking, and progress through tiers. Loyalty state is surfaced on the customer profile (Loyalty Dashboard tab), the main dashboard (Active Members, Loyalty Redeemed KPIs), and both checkout flows. Bilingual EN + AR (RTL); point monetary values in OMR 3 decimals (baisa).

## Primary users / permissions

Receptionists/cashiers (view balance, redeem at checkout), managers (adjustments — permission-gated), admins (earn rules, tier configuration via Settings → Loyalty Settings).

## Tiers

Four tiers: **Bronze → Silver → Gold → Platinum** (`loyalty_accounts.tier`).

- Tier thresholds and multipliers configured in `loyalty_earn_rules`.
- **Active Member** (dashboard KPI definition): Silver/Gold/Platinum tier AND visited within the configured activity period (e.g., last 180 days) AND not inactive/blocked/deleted. Bronze members are not "Active Members" for KPI purposes.
- Customer profile and listing show Membership Type; membership can drive discount eligibility and promotion targeting.

## Loyalty transaction types

`loyalty_transactions.type`:
1. **earn** — points awarded on completed purchases; each earn row carries `expires_at` (expiry_months from earn rules)
2. **redeem** — points converted to discount value (`baisa_value`), referenced to an invoice
3. **expire** — points removed when past `expires_at`; consumed **FIFO** (oldest earn rows expire/redeem first)
4. **adjust** — manual adjustments / bonus points (Points History lists "Adjustments" and "Bonus points")

Account state: `loyalty_accounts` (1:1 customer) holds `points_balance` and `lifetime_points`.

## Earn rules

- Configured in `loyalty_earn_rules`: `baisa_per_point` (spend required per point), tier thresholds, tier multipliers, `expiry_months`.
- Customer-facing "Earn Rules" tab (customer Loyalty Dashboard) displays how points are earned.
- Loyalty Earned is displayed **before** commit in both POS order summary and appointment Review & Book, and awarded on completion.
- Points expiry job: daily repeatable BullMQ job at 03:00 Asia/Muscat writes `expire` transactions FIFO.

## Customer-facing Loyalty Dashboard (customer profile Tab 5)

Overview cards:
1. Available Points — current usable balance + its monetary value
2. Tier — Bronze/Silver/Gold/Platinum
3. Total Points Earned — cumulative since registration
4. Total Points Redeemed
5. **Points Expiring Soon** — points that will expire shortly if not redeemed

History tabs:
1. Points History — earned, redeemed, adjustments, bonus points
2. Redemptions — all reward redemption records
3. Earn Rules — earning rules display

## Hooks into POS and Appointments

**POS (pos.md)**
- Selecting an existing customer auto-loads Loyalty Points and Membership.
- Order summary lines: Loyalty Redemption (points used) and Loyalty Earned (points to be received).
- Pay & Complete validates loyalty balance, then awards/redeems points (background operation #6) inside the checkout transaction: `loyalty_transactions` rows + `loyalty_accounts.points_balance` update, `ref_invoice` set.
- Walk-in (no customer attached) → no earn/redeem.

**Appointments (appointments.md)**
- Wizard Step 5 (Loyalty & Promotions): shows Available Points, Redemption Value, Redeemable Amount; receptionist enters points to redeem; discount computed instantly; validation covers loyalty balance and minimum spend.
- Step 6 billing summary includes Loyalty Discount line and Loyalty Earned preview.
- Actual ledger writes occur at POS checkout when the appointment is billed.

**Dashboard (dashboard.md)** — Loyalty Redeemed KPI (total points redeemed in period); Active Members KPI.

## Business rules

- Redemption converts points → `baisa_value` discount at a configured rate; discount cannot exceed invoice total or available balance (validated server-side at checkout).
- Expiry is FIFO against earn rows' `expires_at`.
- Manual `adjust` transactions must be permission-gated and audited.
- Loyalty program can be disabled per branch (branch setting "Enable Loyalty Program" — branches.md).
- Promotions (percent/fixed codes in MVP; richer promotions deferred per design-app.md) are validated alongside loyalty at checkout: expiry, eligibility, minimum spend.

## Data-model touchpoints

`loyalty_accounts` (1:1 customer, tier, points_balance, lifetime_points), `loyalty_transactions` (earn|redeem|expire|adjust, points, baisa_value, ref_invoice, expires_at on earn rows), `loyalty_earn_rules` (baisa_per_point, tier thresholds/multipliers, expiry_months), `promotions`, `invoices` (redemption ref, loyalty_redeemed column), `customers`.

## Open questions

- Exact points→OMR redemption rate and whether it differs by tier — configured in Loyalty Settings; defaults needed.
- Tier progression triggers: lifetime points vs rolling-period spend; and does tier ever downgrade?
- "Points Expiring Soon" window (30/60/90 days?) — make it a loyalty setting.
- Tier multipliers on earn (e.g., Gold earns 1.5×) — schema supports multipliers; PDF doesn't state values.
- Whether redemption at appointment booking places a hold on points before POS billing, or is re-validated at checkout only.

## Reconciliation vs 2026 client requirement doc

- ✅ **Loyalty is IN SCOPE and retained.** The 2026 client req contains no standalone Loyalty section, but that document is a **partial excerpt, not a de-scope list** (same basis as [[notifications]]) — its silence is not a removal. This doc's full mechanics (points earn/redeem/expiry, FIFO expiry, wallet, memberships/packages) stand.
- What the req **does** actively refine (via Customers): the tier ladder now adds a **"New" tier** plus a default tier, and the tier is **directly editable** on the customer record — see [[customers]]. This updates the Bronze→Silver→Gold→Platinum ladder in this doc.
- POS ([[pos]]) newly promotes **Packages/Memberships** to in-scope cart items, which touches loyalty/membership modelling — cross-check when building.

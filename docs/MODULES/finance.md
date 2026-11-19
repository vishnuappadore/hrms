# Finance

```
status: planned
```

> **Deferral note (design-app.md §9):** full finance — AR/AP aging, reconciliation, formal P&L, payroll runs/payslips — is **deferred from MVP**. MVP ships the unified `finance_transactions` ledger written automatically by POS and other flows; P&L and reports are queries over that ledger, added later without schema surgery.

## Purpose

Financial control center of Keystone HR. Real-time visibility into revenue, expenses, profitability, supplier payments, and branch performance. Bilingual EN + AR (RTL); all amounts OMR 3 decimals stored as BIGINT baisa.

## Primary users / permissions

Accountant, Management Team, Super Admin. Branch Managers: branch-level figures for assigned branches only; consolidated financial reports are Super Admin / corporate only (see dashboard.md access rules).

## Module structure (per PDF)

```
Finance
├── Dashboard
├── Revenue Management
├── Expenses
├── Supplier Payments
├── Payroll Expenses
├── Cash & Bank
├── Branch P&L
├── Accounts Receivable
├── Accounts Payable
├── Transactions
├── Reports
└── Activity Log
```

The PDF specifies the structure and integration intent; detailed field-level specs for most sub-screens are not provided (screens shown as mockups only).

## Integration points

Finance integrates with:
- **Appointments / Services / POS** — every completed sale records service and product revenue (`finance_transactions` category `sale_revenue`) as part of the POS checkout transaction (POS background operation #4), plus cash drawer / payment ledger update (#5).
- **Inventory / Procurement** — supplier payments (`supplier_payment`), GRN-driven stock value.
- **Payroll** — payroll expenses (`payroll`) — deferred with payroll runs.
- **Loyalty** — redemption value affects net revenue; refunds (`refund`).
- **Branch operations** — Branch P&L = per-branch queries over the ledger.

## MVP scope vs deferred

| Area | MVP | Deferred |
|---|---|---|
| Transactions ledger | Yes — `finance_transactions` written by POS/refunds/expenses | — |
| Revenue management | Via dashboard KPIs + transactions list | Dedicated revenue screens |
| Expenses | Simple `expenses` capture | Approval workflows |
| Supplier payments | Schema only | Payment scheduling, AP |
| Payroll expenses | — | Payroll runs, payslips |
| Cash & Bank | Cash drawer updates via POS | Reconciliation |
| Branch P&L | — | Formal P&L reports |
| AR / AP | — | Aging reports |
| Reports | Basic exports | Full report suite |
| Activity Log | `audit_logs` (cross-cutting) | — |

## Business rules

- Single unified simple ledger: `finance_transactions` (direction `in|out`; category `sale_revenue | expense | supplier_payment | payroll | refund | other`; amount baisa; method; polymorphic ref; occurred_at). P&L is a query, not a stored artifact.
- Ledger rows are written inside the same transaction as their source event (POS checkout), never asynchronously.
- Refunds/voids reduce net revenue in all dashboard formulas.
- Money invariants property-tested in baisa (design-app.md Risks §3).

## Data-model touchpoints

`finance_transactions`, `expenses`, `invoices` + `payments` (revenue source), `purchase_orders` / `goods_receipts` / `suppliers` (AP side, later), `staff_profiles` (payroll, later), `audit_logs` (activity log).

## Open questions

- Finance Dashboard KPIs/widgets are shown only as mockups in the PDF — field-level spec needed before build.
- Cash & Bank: is a bank-account entity required, or is `method` on transactions sufficient for v1 reporting?
- Expense categories taxonomy — fixed list vs tenant-configurable (Finance Settings).
- AR: does the salon ever invoice on credit (partially_paid invoices exist in schema) — confirm business need for receivables tracking timing.

## Reconciliation vs 2026 client requirement doc

- Reviewed against the 2026 req (FINANCE section) — the module tree is identical: Dashboard, Revenue, Expenses, Supplier Payments, Payroll Expenses, Cash & Bank, Branch P&L, Accounts Receivable, Accounts Payable, Transactions, Reports, Activity Log. No changes required.
- The req's **Finance Dashboard** heading is an empty stub (no KPI/field spec) — the Finance Dashboard KPI open question above stays unresolved.
- **Payroll Expenses** now has a concrete upstream: the new [[payroll]] module. The prior "deferred with payroll runs" note should be read in light of that module's scope.

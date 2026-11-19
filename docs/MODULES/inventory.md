# Inventory

```
status: planned
```

## Purpose

Central stock-management system for Keystone HR. Maintains a **centralized product catalog shared across all branches**, distributes opening stock branch-by-branch, monitors stock health, and keeps per-branch quantities accurate for both retail sale (POS) and salon-service consumption. Integrates with POS/Checkout, Appointments, Procurement, Reports, and Branch Management. Bilingual EN + AR (RTL); prices stored as **integer minor units** in the tenant/branch currency (OMR exponent = 3 → baisa; USD exponent = 2).

## Primary users / permissions

Inventory/branch managers, Operations, Super Admin. Branch-scoped roles see stock of their assigned branches only (`getEffectiveBranchIds()`). Add Product, Edit Product, and stock adjustments are permission-gated.

## Module navigation

Inventory → Inventory Dashboard · Product List · Add Product · Edit Product · Branch Stock · Stock Adjustment · Reports.

## Functional flow

Create Product → Enter Product Details → Configure branch-wise opening stock → Save → Product available in inventory → Sell via POS / Consume in services → Stock automatically updated.

## Screens & flows

### 1. Inventory Dashboard (Product List)

Real-time overview of inventory across all branches. Combines the four KPI summary cards, search/filters, view toggle, and the product listing.

**Summary cards (4)** — reduced from 6 in the prior doc:
1. **Total Items** — total number of products in inventory (retail products + salon consumables).
2. **Low Stock** — number of products at or below their reorder level; require replenishment.
3. **Out of Stock** — products with zero available quantity; unavailable for sale/consumption until replenished.
4. **Stock Value** — total inventory value = **Current Stock × Cost Price** (aggregated). Represents total inventory investment.

**Search & filters**
- **Search** — matches **Product Name + SKU** only. List updates dynamically as the user types.
- **Category filter** — All, Hair Care, Beard Care, Styling, Color, Consumables (examples; category list is data-driven).
- **Branch filter** — displays stock for a selected branch; changing the branch refreshes quantities and stock status for that location.

**View mode toggle** — **List View** ⇄ **Grid View**. Both show the same product information in different layouts.

**Listing columns** (each row = one inventory item):
1. **Product** — Product Name + SKU.
2. **Category** — assigned inventory category.
3. **Stock** — Current Quantity + a **stock progress bar** visually indicating availability.
4. **Price** — the product's selling (Sale) price.
5. **Status** — auto-determined from available quantity: In Stock / Low / Out of Stock.
6. **Actions** — two quick actions per row:
   - **Add Stock (+)** — opens the stock-adjustment screen to increase inventory for the product.
   - **Edit** — opens the product for modification.

### 2. Add Product — two-step wizard

Triggered by **+ Add Item**. Two steps: Product Details, then Stock by Branch.

**Step 1 — Product Details** (product master info):
1. **Product Name (English)*** — official English name. Required.
2. **Product Name (Arabic)** — Arabic name shown in Arabic mode. Optional but recommended.
3. **Category** — dropdown classifying the product (Hair Care, Styling, Beard Care, Consumables, …).
4. **SKU** — unique Stock Keeping Unit; used for inventory tracking, reporting, barcode mapping. Must be unique.
5. **Sale Price** — selling price shown at POS checkout.
6. **Cost Price** — purchase cost; used for inventory valuation and profit calculations.
7. **Reorder Level** — minimum quantity before the product is flagged Low Stock.
8. **Unit** — measurement unit (pcs, box, bottle, pack, …).

Selecting **Next: Stock** proceeds to branch allocation.

**Step 2 — Stock by Branch** (distribute opening inventory) — **MANDATORY**:
- **Total Quantity** — total opening stock available for allocation.
- **Split Evenly** — helper that distributes Total Quantity equally across all branches (useful for initial setup).
- **Clear** — helper that removes all allocated quantities.
- **Branch allocation rows** — each branch shows: Branch Name · Current Allocated Quantity · **Minus (−)** stepper · **Plus (+)** stepper. Users can manually assign opening stock per branch.
- **Validation gate:** the sum of allocated branch quantities **must equal Total Quantity** before the product can be saved.
- **Save Changes** — creates the product and distributes opening stock across the selected branches (records opening-stock movements per branch).

### 3. Edit Product

Field-limited edit. Administrators may modify only:
- Product Name (English)
- Arabic Name
- Category
- Price (Sale Price)
- Cost Price
- Reorder Level
- Unit

**Branch stock quantities are NOT edited here** — they are managed separately through stock transactions (Add Stock / Stock Adjustment / transfers / procurement).

### 4. Stock Adjustment / Add Stock

Opened via the row **Add Stock (+)** action (and the Stock Adjustment nav item). Increases inventory for the selected product at a branch. All adjustments post to the append-only movement ledger and update the branch stock balance.

### 5. Branch Stock

Per-branch stock view. Stock quantities are maintained **independently for each branch**.

### 6. Reports

Inventory reports (nav item; detail deferred — see Procurement/Reports modules).

## Data model / fields

Product master (catalog, shared across branches):
- `name_en`* (required), `name_ar` (optional), `category`, `sku` (unique), `sale_price` (minor units), `cost_price` (minor units), `reorder_level` (int), `unit` (enum: pcs/box/bottle/pack/…).

Per-branch stock:
- Branch-scoped balance per product (`branch_id`, `product_id`, current quantity). Opening stock seeded per branch during Add Product Step 2.

Movements:
- Append-only ledger of every stock change (opening stock, procurement/goods receipt, manual addition, transfer in/out, POS sale, return, service consumption, manual adjustment).

## Business rules

- A product must belong to **exactly one** inventory category.
- Every product must have a **unique SKU**.
- **Sale Price ≥ Cost Price** (business-policy validation).
- **Reorder Level** determines the Low Stock flag: a product at or below its reorder level is Low Stock.
- Opening stock may be distributed **manually or via Split Evenly** across branches.
- **Total allocated branch quantities must equal the Total Quantity** before the product can be saved (Step 2 gate).
- Stock quantities are maintained **independently for each branch**.
- **Inventory quantities can never go negative — negative stock is hard-prohibited system-wide** (no per-item override).
- Stock increases via: Opening Stock, Procurement (Goods Receipt), Manual Stock Addition, Stock Transfers (in).
- Stock decreases via: POS Product Sales, Product Returns (if configured), Service Consumption, Manual Stock Adjustments, Stock Transfers (out).
- Inventory updates from POS sales and salon service consumption occur **automatically in real time**.
- All stock movements are recorded for audit and reporting.
- Inventory value auto-calculated from Cost Price × current/available stock.

## Status / state machine

Product stock status (auto-derived from available quantity, not a stored field):
- **In Stock** — quantity above reorder level.
- **Low** (Low Stock) — quantity at or below reorder level (and > 0).
- **Out of Stock** — quantity = 0.

## Integrations

- **Procurement** → feeds Inventory Master (goods receipts increase stock).
- **POS / Checkout** ← checks stock and decrements on sale.
- **Appointments** ← service consumption decrements consumable stock automatically on completion.
- **Branch Management** ← per-branch stock scoping.
- **Reports** ← inventory valuation, stock, movements.

## Engineering notes (invariants)

- **Tenant isolation / RLS**: `products`, per-branch stock, and movement tables are tenant tables — `tenant_id` + RLS (ENABLE **and** FORCE) + `tenant_isolation` policy, added in the same migration that creates them. Runtime connects as `hayryou_app`; all access via `PrismaService.client` / `withTenantTx()`.
- **Money = integer minor units + ISO 4217**: Sale Price, Cost Price, and Stock Value are BIGINT minor units. Stock Value = Current Stock × Cost Price computed via `packages/shared/src/money.ts` — never floats, never mixed currencies. Currency resolves tenant default → branch. *Example:* Cost Price OMR 1.500 stored as `1500` baisa; current stock 12 → Stock Value `18000` baisa = OMR 18.000.
- **API contract**: zod schema in `packages/shared` first (product create/edit, per-branch opening-stock allocation array, stock adjustment) → `createZodDto` in API → same schema in web forms. The Step 2 "sum of allocations = total" rule is a shared zod refinement. Errors return stable `code`s from `ERROR_CODES` (e.g. duplicate SKU, allocation-mismatch, sale-below-cost, negative-stock).
- **Permissions**: keys in `packages/shared/src/permissions.ts`; guards `@Permissions(...)`, `@BranchScoped(...)`; list/branch queries use `getEffectiveBranchIds()`.
- **Migrations**: expand → migrate → contract; never rename/drop in one step.
- **Movement ledger**: all stock changes go through an append-only movements table (opening, sale, consumption, receipt, transfer in/out, adjustment, return); branch balances derived/maintained separately. Negative balances rejected at write time.
- **MVP note** (carried from prior doc / design-app.md §9): procurement chain and transfer approvals deferred — MVP uses manual stock adjustments (Add Stock / Stock Adjustment). Confirm still valid.

## ⚠️ Changed in this revision (2026 req vs prior doc)

- **Add Product is now a 2-step wizard** (Step 1 Product Details → Step 2 Stock by Branch), replacing the prior single-screen 7-section form. Branch-wise **opening stock is now MANDATORY** with Total Quantity + Split Evenly + Clear helpers and per-branch −/+ steppers.
- **New hard save gate:** allocated branch quantities must **equal** Total Quantity before Save.
- **Negative stock is now HARD-PROHIBITED system-wide.** The prior per-item **Allow Negative Stock** toggle is removed.
- **Dashboard KPI cards reduced 6 → 4:** now Total Items, Low Stock, Out of Stock, Stock Value. Dropped **In Stock**, **Inventory Value** (renamed/redefined), and **Monthly Usage** cards.
- **Stock Value formula fixed to Current Stock × Cost Price** (prior doc had conflicting `Available Stock × Unit Cost` list column vs `Current Stock × Unit Cost` KPI). "Cost Price" replaces "Unit Cost" naming.
- **List columns simplified** to Product / Category / Stock / Price / Status / Actions. Dropped columns: Branches count, Current Stock (now folded into Stock), **Reserved Stock**, **Available Stock**, Reorder Level, Inventory Value.
- **Stock column now shows a progress bar** for visual availability (new).
- **Row actions reduced to two:** Add Stock (+) and Edit. Dropped View, Transfer Stock, Adjust Stock (kebab), View Activity, **Deactivate Item**.
- **List/Grid view toggle added** (new).
- **Search scope narrowed to Name + SKU** (prior doc also searched Barcode + Brand).
- **Status enum label changed:** "Low Stock" → "Low" (In Stock / Low / Out of Stock).
- **Edit Product is field-limited** (Name, Arabic Name, Category, Price, Cost Price, Reorder Level, Unit); branch stock explicitly editable only via stock transactions.
- **Bilingual product name is explicit** — separate Product Name (English, required) and Product Name (Arabic, optional).
- **New business rule:** Sale Price ≥ Cost Price.

## ❓ Open questions / needs client confirmation

- **Reserved / Available stock reservation model — DROPPED entirely.** Prior doc specced Reserved Stock (upcoming appointments, pending orders, package reservations) and `Available Stock = Current Stock − Reserved Stock` governing POS sellability. The 2026 req has no reservation concept; status/POS now appear to key off **Current Stock** alone. *Previously specced; not present in 2026 client doc — confirm DE-SCOPED vs DEFERRED.* **POS implication:** without reservations, concurrent POS sales / appointment consumption could oversell the same units — confirm how sellability is guarded now that negative stock is hard-prohibited.
- **Barcode field — DROPPED** from Add Product (req mentions SKU is used for "barcode mapping" but has no Barcode input). *Previously specced; confirm DE-SCOPED vs DEFERRED.*
- **Brand field — DROPPED.** *Previously specced; confirm DE-SCOPED vs DEFERRED.*
- **Description field — DROPPED.** *Previously specced; confirm DE-SCOPED vs DEFERRED.*
- **Tax % + Tax Inclusive toggle — DROPPED** from the product form (prior default 5%). *Previously specced; confirm DE-SCOPED vs DEFERRED* (and where POS VAT now comes from — branch-level settings?).
- **Supplier information (Supplier, Supplier Item Code, Country of Origin) — DROPPED.** *Previously specced; confirm DE-SCOPED vs DEFERRED* (likely moved to Procurement module).
- **Product Image / upload — DROPPED** (prior JPG/PNG/WEBP). Listing no longer shows a product image. *Previously specced; confirm DE-SCOPED vs DEFERRED.*
- **Additional Information (Shelf Life, Storage Instructions, internal Notes) — DROPPED.** *Previously specced; confirm DE-SCOPED vs DEFERRED.*
- **Track Stock toggle — DROPPED** (prior: disable to run service-only items with no quantities). With mandatory opening stock, is every product now stock-tracked? *Confirm DE-SCOPED vs DEFERRED.*
- **Consumable Item toggle + Service Consumption Mapping (`service_consumables`, Used-In-Services, per-service consumption qty) — DROPPED from the product form**, yet the req still says service consumption auto-deducts stock. How are consumables now flagged and mapped to services for auto-deduction? *Previously specced; confirm DE-SCOPED vs DEFERRED — critical for the Appointments→Inventory integration.*
- **Item-detail tabs (Overview / Transactions / Consumption / Transfers / Purchase History / Activity Log) and the combined View/Edit item-detail screen — DROPPED.** Req has no product detail/view screen (row action is Edit only). *Previously specced; confirm DE-SCOPED vs DEFERRED* (esp. where users now see per-product movement history / audit trail, which the req still requires be maintained).
- **Export action — DROPPED** from the list toolbar. *Previously specced; confirm DE-SCOPED vs DEFERRED.*
- **Monthly Usage metric — DROPPED** (was KPI card #6). *Previously specced; confirm DE-SCOPED vs DEFERRED.*
- **Save Draft / product draft state — DROPPED.** Add Product now only Saves (creates) or Cancels; no draft. *Previously specced; confirm DE-SCOPED vs DEFERRED* (removes the need for a product draft/active status field).
- **Deactivate Item — DROPPED** from row actions. Is product lifecycle (active/inactive) still needed, and how are products retired? *Confirm DE-SCOPED vs DEFERRED.*
- **SKU generation:** prior doc allowed system-generated or manual SKU; req says "generate or validate unique SKU" but the form field is a plain input — confirm whether auto-generation is still offered.
- **Split Evenly rounding:** when Total Quantity isn't divisible by branch count, how is the remainder distributed (and does the result still need to satisfy the exact sum = total gate)? — needs a defined rule.
- **Branch set for allocation:** does Step 2 list all tenant branches or only branches the creating user is scoped to? Confirm interaction with `getEffectiveBranchIds()`.

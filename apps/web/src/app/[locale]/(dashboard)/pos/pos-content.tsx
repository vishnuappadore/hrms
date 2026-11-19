"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Printer, Trash2, X } from "lucide-react";
import {
  computeInvoiceTotals,
  currencyExponent,
  formatMoney,
  fromMinorUnits,
  PAYMENT_METHODS,
  toMinorUnits,
  type CheckoutInput,
  type Invoice,
  type PaymentMethod,
  type Product,
  type Service,
} from "@keystonehr/shared";
import { api, ApiError } from "@/lib/api-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StepperInput } from "@/components/ui/stepper-input";
import { cn } from "@/lib/cn";
import { usePermissions } from "@/lib/permissions";
import { useBranches, type BranchDetail } from "@/lib/queries/branches";
import { useServices } from "@/lib/queries/services";
import { useCustomer, useCustomers } from "@/lib/queries/customers";
import { useAppointment } from "@/lib/queries/appointments";
import { useCompanySettings } from "@/lib/queries/company-settings";
import { useProducts, usePosBranch, useCheckout, useWalkInForCheckout } from "@/lib/queries/pos";
import { buildReceiptHtml } from "./print-receipt";

type CatalogTab = "services" | "products";
interface CartLine {
  type: "service" | "product";
  id: string;
  nameEn: string;
  nameAr: string | null;
  unitPriceMinor: number;
  quantity: number;
}
interface PaymentRow {
  method: PaymentMethod;
  amount: string; // major units, as typed
}

function servicePriceMinor(s: Service, branchId: string): number {
  return s.branchOverrides.find((o) => o.branchId === branchId)?.priceOverrideMinor ?? s.priceMinor;
}

export function PosContent({
  appointmentId,
  initialCustomerId,
  walkInId,
}: {
  appointmentId: string | null;
  initialCustomerId: string | null;
  walkInId: string | null;
}) {
  const t = useTranslations("pos");
  const tc = useTranslations("common");
  const locale = useLocale();
  const permissions = usePermissions();

  const branchesQuery = useBranches({ status: "active", pageSize: 100 });
  const branches = branchesQuery.data?.data ?? [];
  const [branchId, setBranchId] = useState<string | undefined>();
  useEffect(() => {
    if (!branchId && !appointmentId && !walkInId && branches.length > 0) setBranchId(branches[0]!.id);
  }, [branches, branchId, appointmentId, walkInId]);

  const posBranch = usePosBranch(branchId);
  const currency = posBranch.data?.currency ?? "OMR";
  const exponent = currency ? safeExponent(currency) : 3;
  const companySettingsQuery = useCompanySettings();

  const [tab, setTab] = useState<CatalogTab>("services");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerLabel, setCustomerLabel] = useState<string | null>(null);
  const [discountMajor, setDiscountMajor] = useState("");
  const [payments, setPayments] = useState<PaymentRow[]>([{ method: "cash", amount: "" }]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Invoice | null>(null);

  const servicesQuery = useServices({ branchId, status: "active", pageSize: 100 });
  const productsQuery = useProducts({ branchId, status: "active", pageSize: 100 });

  // ── appointment → POS prefill (entry point 2), once ──────────────────────
  const apptQuery = useAppointment(appointmentId);
  const prefilled = useRef(false);
  useEffect(() => {
    const a = apptQuery.data;
    if (!a || prefilled.current) return;
    prefilled.current = true;
    setBranchId(a.branchId);
    if (a.customer) {
      setCustomerId(a.customer.id);
      setCustomerLabel(`${a.customer.name} · ${a.customer.mobile}`);
    }
    setCart(
      a.services.map((s) => ({
        type: "service" as const,
        id: s.serviceId,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        unitPriceMinor: s.priceMinor,
        quantity: 1,
      })),
    );
  }, [apptQuery.data]);

  // ── walk-in → POS prefill (entry point 3), once ──────────────────────────
  const walkInQuery = useWalkInForCheckout(walkInId);
  const prefilledWalkIn = useRef(false);
  useEffect(() => {
    const w = walkInQuery.data;
    if (!w || prefilledWalkIn.current) return;
    prefilledWalkIn.current = true;
    setBranchId(w.branchId);
    if (w.customer) {
      setCustomerId(w.customer.id);
      setCustomerLabel(`${w.customer.name} · ${w.customer.mobile}`);
    }
    setCart(
      w.services.map((s) => ({
        type: "service" as const,
        id: s.serviceId,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        unitPriceMinor: s.priceMinor,
        quantity: 1,
      })),
    );
  }, [walkInQuery.data]);

  // ── customer → POS prefill (from the Customers list), once ───────────────
  const prefillCustomerQuery = useCustomer(initialCustomerId ?? "");
  const prefilledCustomer = useRef(false);
  useEffect(() => {
    const c = prefillCustomerQuery.data;
    if (!c || prefilledCustomer.current) return;
    prefilledCustomer.current = true;
    setCustomerId(c.id);
    setCustomerLabel(`${c.name} · ${c.mobile}`);
  }, [prefillCustomerQuery.data]);

  // ── totals (same computeInvoiceTotals the server uses → exact match) ──────
  const discountMinor = discountMajor ? toMinorUnits(Number(discountMajor) || 0, currency) : 0;
  const totals = useMemo(
    () =>
      computeInvoiceTotals({
        lineTotalsMinor: cart.map((l) => l.unitPriceMinor * l.quantity),
        discountMinor,
        taxComponents: posBranch.data?.taxComponents ?? [],
      }),
    [cart, discountMinor, posBranch.data],
  );

  // auto-sync a single payment row to the total; split rows are edited by hand
  useEffect(() => {
    setPayments((prev) => {
      if (prev.length !== 1) return prev;
      const want = fromMinorUnits(totals.totalMinor, currency).toFixed(exponent);
      return prev[0]!.amount === want ? prev : [{ ...prev[0]!, amount: want }];
    });
  }, [totals.totalMinor, currency, exponent]);

  const paidMinor = payments.reduce(
    (sum, p) => sum + (p.amount ? toMinorUnits(Number(p.amount) || 0, currency) : 0),
    0,
  );
  const balanceMinor = totals.totalMinor - paidMinor;
  const canCharge = cart.length > 0 && !!branchId && balanceMinor === 0 && discountMinor <= totals.subtotalMinor;

  function addLine(line: Omit<CartLine, "quantity">) {
    setCart((prev) => {
      const i = prev.findIndex((l) => l.type === line.type && l.id === line.id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i]!, quantity: next[i]!.quantity + 1 };
        return next;
      }
      return [...prev, { ...line, quantity: 1 }];
    });
  }
  function setQty(idx: number, quantity: number) {
    setCart((prev) => prev.map((l, i) => (i === idx ? { ...l, quantity } : l)));
  }
  function removeLine(idx: number) {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  }

  const checkout = useCheckout();
  async function charge() {
    if (!branchId) return;
    setServerError(null);
    const input: CheckoutInput = {
      branchId,
      customerId: customerId ?? undefined,
      appointmentId: appointmentId ?? undefined,
      walkInId: walkInId ?? undefined,
      items: cart.map((l) => ({ type: l.type, id: l.id, quantity: l.quantity })),
      discountMinor,
      payments: payments.map((p) => ({
        method: p.method,
        amountMinor: toMinorUnits(Number(p.amount) || 0, currency),
      })),
    };
    try {
      const invoice = await checkout.mutateAsync(input);
      setReceipt(invoice);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "NETWORK";
      setServerError(
        code === "VALIDATION_FAILED"
          ? t("errors.validation")
          : code === "INVALID_STATUS_TRANSITION"
            ? t("errors.walkInNotServing")
            : t("errors.generic"),
      );
    }
  }

  function newSale() {
    setReceipt(null);
    setCart([]);
    setCustomerId(null);
    setCustomerLabel(null);
    setDiscountMajor("");
    setPayments([{ method: "cash", amount: "" }]);
    setServerError(null);
  }

  async function printReceipt() {
    if (!receipt) return;
    let branchDetail: BranchDetail | undefined;
    if (receipt.branchId) {
      try {
        branchDetail = await api<BranchDetail>(`/branches/${receipt.branchId}`);
      } catch {
        branchDetail = undefined;
      }
    }
    const html = buildReceiptHtml({
      invoice: receipt,
      branch: branchDetail,
      company: companySettingsQuery.data,
      locale,
      t,
    });

    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    if (!doc) {
      iframe.remove();
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) {
        iframe.remove();
        return;
      }
      win.addEventListener("afterprint", () => iframe.remove(), { once: true });
      win.focus();
      win.print();
    };
    setTimeout(() => {
      if (iframe.isConnected) iframe.remove();
    }, 60_000);
  }

  const money = (m: number) => formatMoney(m, currency, locale);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <Select
          value={branchId ?? ""}
          onChange={(e) => {
            setBranchId(e.target.value || undefined);
            setCart([]);
          }}
          className="w-56"
          aria-label={t("branch")}
          disabled={!!appointmentId || !!walkInId}
        >
          {branches.length === 0 ? (
            <option value="">{t("noBranches")}</option>
          ) : (
            branches.map((b) => (
              <option key={b.id} value={b.id}>
                {locale === "ar" ? b.nameAr : b.nameEn}
              </option>
            ))
          )}
        </Select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* ── Catalogue ─────────────────────────────────────────────── */}
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl<CatalogTab>
              options={[
                { value: "services", label: t("tabs.services") },
                { value: "products", label: t("tabs.products") },
              ]}
              value={tab}
              onChange={setTab}
              aria-label={t("tabs.label")}
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tc("search")}
              className="max-w-52"
            />
          </div>

          <div className="grid max-h-[62vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {tab === "services"
              ? (servicesQuery.data?.data ?? [])
                  .filter((s) => matches(search, locale === "ar" ? s.nameAr : s.nameEn))
                  .map((s) => {
                    const price = branchId ? servicePriceMinor(s, branchId) : s.priceMinor;
                    return (
                      <CatalogCard
                        key={s.id}
                        title={locale === "ar" ? s.nameAr : s.nameEn}
                        subtitle={t("minutes", { minutes: s.durationMinutes })}
                        price={money(price)}
                        onAdd={() =>
                          addLine({ type: "service", id: s.id, nameEn: s.nameEn, nameAr: s.nameAr, unitPriceMinor: price })
                        }
                      />
                    );
                  })
              : (productsQuery.data?.data ?? [])
                  .filter((p) => matches(search, (locale === "ar" ? p.nameAr : p.nameEn) ?? p.nameEn))
                  .map((p: Product) => {
                    const out = (p.stockQuantity ?? 0) <= 0;
                    return (
                      <CatalogCard
                        key={p.id}
                        title={(locale === "ar" ? p.nameAr : p.nameEn) ?? p.nameEn}
                        subtitle={[p.brand, out ? t("outOfStock") : t("inStock", { n: p.stockQuantity ?? 0 })]
                          .filter(Boolean)
                          .join(" · ")}
                        price={money(p.salePriceMinor)}
                        disabled={out}
                        onAdd={() =>
                          addLine({ type: "product", id: p.id, nameEn: p.nameEn, nameAr: p.nameAr, unitPriceMinor: p.salePriceMinor })
                        }
                      />
                    );
                  })}
          </div>
        </section>

        {/* ── Current Sale + Payment ────────────────────────────────── */}
        <section className="flex flex-col gap-4">
          <CustomerBox
            customerLabel={customerLabel}
            onPick={(id, label) => {
              setCustomerId(id);
              setCustomerLabel(label);
            }}
            onWalkIn={() => {
              setCustomerId(null);
              setCustomerLabel(null);
            }}
          />

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold">{t("currentSale")}</h2>
            {cart.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("emptyCart")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {cart.map((l, i) => (
                  <li key={`${l.type}:${l.id}`} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {locale === "ar" ? (l.nameAr ?? l.nameEn) : l.nameEn}
                      </div>
                      <div className="text-xs text-muted-foreground">{money(l.unitPriceMinor)}</div>
                    </div>
                    <StepperInput value={l.quantity} min={1} max={999} onChange={(q) => setQty(i, q)} />
                    <div className="w-20 text-end text-sm font-medium tabular-nums">
                      {money(l.unitPriceMinor * l.quantity)}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      aria-label={tc("remove")}
                      className="text-muted-foreground transition hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Payment Summary */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">{t("paymentSummary")}</h2>
            <dl className="space-y-1.5 text-sm">
              <Row label={t("subtotal")} value={money(totals.subtotalMinor)} />
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{t("discount")}</dt>
                <dd>
                  <Input
                    type="number"
                    min={0}
                    step={1 / 10 ** exponent}
                    dir="ltr"
                    value={discountMajor}
                    onChange={(e) => setDiscountMajor(e.target.value)}
                    placeholder="0"
                    className="h-8 w-28 text-end"
                  />
                </dd>
              </div>
              {totals.taxBreakdown.map((tx) => (
                <Row key={tx.name} label={`${tx.name} (${tx.ratePercent}%)`} value={money(tx.amountMinor)} />
              ))}
              <div className="flex items-center justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
                <dt>{t("total")}</dt>
                <dd className="tabular-nums">{money(totals.totalMinor)}</dd>
              </div>
            </dl>

            {/* Payments */}
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{t("payments")}</span>
                <button
                  type="button"
                  onClick={() => setPayments((p) => [...p, { method: "card", amount: "" }])}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  + {t("splitPayment")}
                </button>
              </div>
              {payments.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select
                    value={p.method}
                    onChange={(e) =>
                      setPayments((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, method: e.target.value as PaymentMethod } : x)),
                      )
                    }
                    className="w-36"
                    aria-label={t("method")}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {t(`methods.${m}`)}
                      </option>
                    ))}
                  </Select>
                  <Input
                    type="number"
                    min={0}
                    step={1 / 10 ** exponent}
                    dir="ltr"
                    value={p.amount}
                    onChange={(e) =>
                      setPayments((prev) => prev.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
                    }
                    className="h-9 flex-1 text-end"
                  />
                  {payments.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setPayments((prev) => prev.filter((_, j) => j !== i))}
                      aria-label={tc("remove")}
                      className="text-muted-foreground transition hover:text-destructive"
                    >
                      <X className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  ) : null}
                </div>
              ))}
              {balanceMinor !== 0 && cart.length > 0 ? (
                <p className={cn("text-xs", balanceMinor > 0 ? "text-muted-foreground" : "text-destructive")}>
                  {balanceMinor > 0 ? t("balanceDue", { amount: money(balanceMinor) }) : t("overpaid", { amount: money(-balanceMinor) })}
                </p>
              ) : null}
            </div>

            {serverError ? <Alert className="mt-3">{serverError}</Alert> : null}

            {permissions.includes("pos.use") && (
              <Button onClick={charge} disabled={!canCharge || checkout.isPending} className="mt-4 h-11 w-full text-base">
                {checkout.isPending ? t("charging") : `${t("charge")} · ${money(totals.totalMinor)}`}
              </Button>
            )}
          </div>
        </section>
      </div>

      {/* Receipt */}
      <Dialog
        open={receipt !== null}
        onClose={newSale}
        title={receipt ? t("receipt.title", { number: receipt.invoiceNo }) : undefined}
        size="md"
      >
        {receipt ? (
          <div className="space-y-3">
            <dl className="space-y-1.5 text-sm">
              <Row label={t("subtotal")} value={money(receipt.subtotalMinor)} />
              {receipt.discountMinor > 0 ? <Row label={t("discount")} value={`−${money(receipt.discountMinor)}`} /> : null}
              {receipt.taxBreakdown.map((tx) => (
                <Row key={tx.name} label={`${tx.name} (${tx.ratePercent}%)`} value={money(tx.amountMinor)} />
              ))}
              <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
                <dt>{t("total")}</dt>
                <dd>{money(receipt.totalMinor)}</dd>
              </div>
            </dl>
            <div className="rounded-lg bg-muted/40 p-2 text-xs text-muted-foreground">
              {receipt.payments.map((p) => `${t(`methods.${p.method}`)} ${money(p.amountMinor)}`).join(" · ")}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void printReceipt()}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3.5 text-sm font-medium transition hover:bg-muted"
              >
                <Printer className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t("receipt.printInvoice")}
              </button>
              <Button onClick={newSale} className="flex-1">
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t("newSale")}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

function safeExponent(currency: string): number {
  try {
    return currencyExponent(currency);
  } catch {
    return 2;
  }
}
function matches(q: string, name: string): boolean {
  return !q || name.toLowerCase().includes(q.toLowerCase());
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function CatalogCard({
  title,
  subtitle,
  price,
  disabled,
  onAdd,
}: {
  title: string;
  subtitle?: string;
  price: string;
  disabled?: boolean;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={disabled}
      className={cn(
        "flex flex-col items-start gap-1 rounded-lg border border-border bg-card p-2.5 text-start shadow-sm transition",
        disabled ? "cursor-not-allowed opacity-50" : "hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <span className="line-clamp-2 text-sm font-medium">{title}</span>
      {subtitle ? <span className="text-xs text-muted-foreground">{subtitle}</span> : null}
      <span className="mt-auto text-sm font-semibold text-primary">{price}</span>
    </button>
  );
}

function CustomerBox({
  customerLabel,
  onPick,
  onWalkIn,
}: {
  customerLabel: string | null;
  onPick: (id: string, label: string) => void;
  onWalkIn: () => void;
}) {
  const t = useTranslations("pos");
  const [q, setQ] = useState("");
  const results = useCustomers({ search: q.length >= 2 ? q : undefined, pageSize: 5 });

  if (customerLabel) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{t("customer")}</div>
          <div className="truncate text-sm font-medium">{customerLabel}</div>
        </div>
        <button type="button" onClick={onWalkIn} className="text-xs font-medium text-primary hover:underline">
          {t("clear")}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{t("customer")}</span>
        <span className="text-xs text-muted-foreground">{t("walkIn")}</span>
      </div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchCustomer")} />
      {q.length >= 2 && (results.data?.data?.length ?? 0) > 0 ? (
        <ul className="mt-1.5 overflow-hidden rounded-lg border border-border">
          {results.data!.data.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(c.id, `${c.name} · ${c.mobile}`);
                  setQ("");
                }}
                className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-start text-sm transition hover:bg-muted"
              >
                <span className="truncate">{c.name}</span>
                <span dir="ltr" className="text-xs text-muted-foreground">
                  {c.mobile}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

import { formatMoney } from "@keystonehr/shared";
import type { Invoice, PaymentMethod } from "@keystonehr/shared";

const STRINGS = {
  en: {
    invoice: "Invoice",
    invoiceNo: "Invoice No.",
    date: "Date",
    customer: "Customer",
    walkInCustomer: "Walk-in (no customer)",
    items: "Items",
    qty: "Qty",
    unitPrice: "Unit Price",
    lineTotal: "Total",
    subtotal: "Subtotal",
    discount: "Discount",
    tax: "Tax",
    grandTotal: "Total",
    payments: "Payments",
    reference: "Ref",
    generatedAt: "Generated",
  },
  ar: {
    invoice: "فاتورة",
    invoiceNo: "رقم الفاتورة",
    date: "التاريخ",
    customer: "العميل",
    walkInCustomer: "زيارة مباشرة (بدون عميل)",
    items: "العناصر",
    qty: "الكمية",
    unitPrice: "سعر الوحدة",
    lineTotal: "الإجمالي",
    subtotal: "المجموع الفرعي",
    discount: "الخصم",
    tax: "الضريبة",
    grandTotal: "الإجمالي",
    payments: "المدفوعات",
    reference: "المرجع",
    generatedAt: "تاريخ الإصدار",
  },
} as const;

/** Mirrors apps/web's `pos.methods.*` i18n labels exactly. */
const METHOD_LABEL: Record<PaymentMethod, Record<"en" | "ar", string>> = {
  cash: { en: "Cash", ar: "نقدًا" },
  card: { en: "Card", ar: "بطاقة" },
  mada: { en: "Mada", ar: "مدى" },
  bank_transfer: { en: "Bank Transfer", ar: "تحويل بنكي" },
  ewallet: { en: "eWallet", ar: "محفظة إلكترونية" },
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function row(label: string, amount: string, tone: "" | "negative" = ""): string {
  return `<div class="row"><span>${escapeHtml(label)}</span><span class="amt ${tone}">${escapeHtml(amount)}</span></div>`;
}

/**
 * Bilingual, print-friendly invoice/receipt — same light, printable theme and
 * headless-Chromium rendering approach (InvoicePdfService) as the payslip
 * export (payslip-pdf.template.ts), for Arabic text-shaping fidelity.
 */
export function renderInvoiceHtml(invoice: Invoice, locale: "en" | "ar", tenantName: string): string {
  const t = STRINGS[locale];
  const dir = locale === "ar" ? "rtl" : "ltr";
  const fmt = (minor: number) => formatMoney(minor, invoice.currency, locale);
  const nameOf = (en: string, ar: string | null) => (locale === "ar" ? (ar ?? en) : en);

  const itemRows = invoice.items
    .map(
      (i) => `<tr>
        <td>${escapeHtml(nameOf(i.nameEn, i.nameAr))}</td>
        <td class="num">${i.quantity}</td>
        <td class="num amt">${escapeHtml(fmt(i.unitPriceMinor))}</td>
        <td class="num amt">${escapeHtml(fmt(i.lineTotalMinor))}</td>
      </tr>`,
    )
    .join("");

  const taxBreakdownHtml = invoice.taxBreakdown
    .map((tx) => row(`${tx.name} (${tx.ratePercent}%)`, fmt(tx.amountMinor)))
    .join("");

  const paymentRows = invoice.payments
    .map(
      (p) =>
        row(
          p.reference ? `${METHOD_LABEL[p.method][locale]} — ${t.reference} ${p.reference}` : METHOD_LABEL[p.method][locale],
          fmt(p.amountMinor),
        ),
    )
    .join("");

  return `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px; color: #1c1e20; background: #ffffff;
    font-family: ${locale === "ar" ? "'Tahoma','Segoe UI',Arial,sans-serif" : "'Segoe UI',Arial,sans-serif"};
    font-size: 13px; line-height: 1.5;
  }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { color: #6b6f78; font-size: 12px; margin: 0 0 20px; }
  .card { border: 1px solid #d8dade; border-radius: 10px; padding: 16px 18px; margin-bottom: 14px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; margin-bottom: 20px; }
  .meta div span:first-child { display: block; font-size: 10.5px; color: #8b8f98; text-transform: uppercase; letter-spacing: .04em; }
  .meta div span:last-child { display: block; font-weight: 600; margin-top: 2px; }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #6b6f78; padding-bottom: 6px; margin-bottom: 8px; border-bottom: 1px solid #eceef1; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: ${dir === "rtl" ? "right" : "left"}; padding: 6px 4px; font-size: 12px; }
  th { color: #8b8f98; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; font-weight: 700; border-bottom: 1px solid #eceef1; }
  td { border-bottom: 1px solid #f3f4f6; }
  .num { text-align: ${dir === "rtl" ? "left" : "right"}; }
  .row { display: flex; justify-content: space-between; padding: 4px 0; }
  .amt { font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: isolate; }
  .amt.negative { color: #b3261e; }
  .total-row { display: flex; justify-content: space-between; border-top: 1px solid #d8dade; margin-top: 8px; padding-top: 8px; font-weight: 700; }
  .grandtotal { display: flex; justify-content: space-between; align-items: center; background: #fbf3e0; border: 1px solid #e7a81f; border-radius: 10px; padding: 14px 18px; margin: 16px 0; }
  .grandtotal .label { font-size: 14px; font-weight: 700; }
  .grandtotal .value { font-size: 22px; font-weight: 800; direction: ltr; unicode-bidi: isolate; }
  .footer { display: flex; justify-content: space-between; color: #6b6f78; font-size: 11px; margin-top: 18px; }
</style>
</head>
<body>
  <h1>${escapeHtml(tenantName)}</h1>
  <p class="sub">${t.invoice} — ${escapeHtml(invoice.invoiceNo)}</p>

  <div class="meta">
    <div><span>${t.invoiceNo}</span><span>${escapeHtml(invoice.invoiceNo)}</span></div>
    <div><span>${t.date}</span><span>${new Date(invoice.createdAt).toISOString().slice(0, 10)}</span></div>
    <div><span>${t.customer}</span><span>${escapeHtml(invoice.customer?.name ?? t.walkInCustomer)}</span></div>
  </div>

  <div class="card">
    <div class="section-title">${t.items}</div>
    <table>
      <thead><tr><th>${t.items}</th><th class="num">${t.qty}</th><th class="num">${t.unitPrice}</th><th class="num">${t.lineTotal}</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div style="margin-top: 10px;">
      ${row(t.subtotal, fmt(invoice.subtotalMinor))}
      ${invoice.discountMinor > 0 ? row(t.discount, `-${fmt(invoice.discountMinor)}`, "negative") : ""}
      ${taxBreakdownHtml}
      <div class="total-row"><span>${t.grandTotal}</span><span class="amt">${fmt(invoice.totalMinor)}</span></div>
    </div>
  </div>

  <div class="card">
    <div class="section-title">${t.payments}</div>
    ${paymentRows}
  </div>

  <div class="grandtotal">
    <span class="label">${t.grandTotal}</span>
    <span class="value">${fmt(invoice.totalMinor)}</span>
  </div>

  <div class="footer">
    <span>${t.generatedAt}: ${new Date().toISOString().slice(0, 10)}</span>
  </div>
</body>
</html>`;
}

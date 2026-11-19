import { formatMoney, type CompanySettings, type Invoice } from "@keystonehr/shared";
import type { BranchDetail } from "@/lib/queries/branches";

type T = (key: string, values?: Record<string, string | number>) => string;

/**
 * Builds a narrow, itemized till-receipt as a SELF-CONTAINED HTML document (own inline <style>,
 * no Tailwind — the hidden iframe this gets printed from has no access to the app's compiled
 * stylesheet). Printed via a hidden <iframe> + `iframe.contentWindow.print()` (pos-content.tsx) —
 * NOT `window.print()` against an in-page element, which real browsers print as a blank page
 * despite looking fine under Playwright's `emulateMedia` CSS simulation.
 *
 * Deliberately NOT the same thing as the A4 "Download Invoice" PDF (Appointments/Walk-in Queue) —
 * that's a formal document; this is a compact retail till-receipt format.
 */
export function buildReceiptHtml({
  invoice,
  branch,
  company,
  locale,
  t,
}: {
  invoice: Invoice;
  branch: BranchDetail | undefined;
  company: CompanySettings | undefined;
  locale: string;
  t: T;
}): string {
  const dir = locale === "ar" ? "rtl" : "ltr";
  const money = (m: number) => formatMoney(m, invoice.currency, locale);
  const dateTimeFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const branchName = branch ? (locale === "ar" ? branch.nameAr : branch.nameEn) : "";
  const branchAddressLine = branch ? [branch.address, branch.city, branch.country].filter(Boolean).join(", ") : "";

  const companyHeader = company
    ? `<div class="center">
        ${company.logoUrl ? `<img src="${esc(company.logoUrl)}" class="logo" alt="" />` : ""}
        <div class="company-name">${esc(company.name)}</div>
        ${company.address ? `<div class="muted">${esc(company.address)}</div>` : ""}
        ${
          company.contactPhone || company.contactEmail
            ? `<div class="muted">${[company.contactPhone, company.contactEmail].filter(Boolean).map((v) => esc(v)).join(" · ")}</div>`
            : ""
        }
        ${company.taxNumber ? `<div class="muted">${esc(t("receipt.vatNumber"))}: ${esc(company.taxNumber)}</div>` : ""}
        ${
          company.commercialRegistrationNo
            ? `<div class="muted">${esc(t("receipt.crNumber"))}: ${esc(company.commercialRegistrationNo)}</div>`
            : ""
        }
      </div>`
    : "";

  const billTo = invoice.customer
    ? `<div class="section">
        <div class="label">${esc(t("receipt.billTo"))}</div>
        <div>${esc(invoice.customer.name)}</div>
        <div class="muted" dir="ltr">${esc(invoice.customer.mobile)}</div>
      </div>`
    : "";

  const itemsHtml = invoice.items
    .map((item) => {
      const name = locale === "ar" && item.nameAr ? item.nameAr : item.nameEn;
      return `<div class="item">
          <div>${esc(name)}</div>
          <div class="row">
            <span>${item.quantity} × ${esc(money(item.unitPriceMinor))}</span>
            <span>${esc(money(item.lineTotalMinor))}</span>
          </div>
        </div>`;
    })
    .join("");

  const taxHtml = invoice.taxBreakdown
    .map(
      (tx) => `<div class="row">
          <span>${esc(tx.name)} (${tx.ratePercent}%)</span>
          <span>${esc(money(tx.amountMinor))}</span>
        </div>`,
    )
    .join("");

  const paymentsHtml = invoice.payments
    .map((p) => {
      const ref = p.reference
        ? `<div class="ref">${esc(t("receipt.reference"))}: ${esc(p.reference)}</div>`
        : "";
      return `<div class="row"><span><strong>${esc(t(`methods.${p.method}`))}</strong></span><span>${esc(money(p.amountMinor))}</span></div>${ref}`;
    })
    .join("");

  return `<!DOCTYPE html>
<html dir="${dir}" lang="${esc(locale)}">
<head>
<meta charset="utf-8" />
<title>${esc(t("receipt.title", { number: invoice.invoiceNo }))}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    width: 300px;
    font-family: "Courier New", Courier, monospace;
    font-size: 12px;
    color: #000;
    background: #fff;
  }
  .center { text-align: center; }
  .logo { max-height: 48px; margin: 0 auto 4px; display: block; }
  .company-name { font-size: 14px; font-weight: bold; }
  .muted { font-size: 11px; }
  .divider { border-top: 1px dashed #000; margin: 8px 0; }
  .section { margin-bottom: 6px; }
  .label { font-size: 11px; font-weight: bold; }
  .row { display: flex; justify-content: space-between; }
  .item { margin-bottom: 4px; }
  .ref { font-size: 10px; padding-inline-start: 8px; }
  .total-row {
    display: flex;
    justify-content: space-between;
    font-weight: bold;
    font-size: 13px;
    border-top: 1px dashed #000;
    padding-top: 4px;
    margin-top: 4px;
  }
</style>
</head>
<body>
  ${companyHeader}
  <div class="divider"></div>
  <div class="center">
    <div>${esc(branchName)}</div>
    ${branchAddressLine ? `<div class="muted">${esc(branchAddressLine)}</div>` : ""}
    ${branch?.mobile ? `<div class="muted" dir="ltr">${esc(branch.mobile)}</div>` : ""}
  </div>
  <div class="divider"></div>
  <div class="row"><span>${esc(t("receipt.title", { number: invoice.invoiceNo }))}</span></div>
  <div class="row"><span>${esc(dateTimeFmt.format(new Date(invoice.createdAt)))}</span></div>
  <div class="divider"></div>
  ${billTo}${billTo ? '<div class="divider"></div>' : ""}
  ${itemsHtml}
  <div class="divider"></div>
  <div class="row"><span>${esc(t("subtotal"))}</span><span>${esc(money(invoice.subtotalMinor))}</span></div>
  ${
    invoice.discountMinor > 0
      ? `<div class="row"><span>${esc(t("discount"))}</span><span>−${esc(money(invoice.discountMinor))}</span></div>`
      : ""
  }
  ${taxHtml}
  <div class="total-row"><span>${esc(t("total"))}</span><span>${esc(money(invoice.totalMinor))}</span></div>
  <div class="divider"></div>
  ${paymentsHtml}
  <div class="divider"></div>
  <div class="center">${esc(t("receipt.thankYou"))}</div>
</body>
</html>`;
}

function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

import { formatMoney } from "@keystonehr/shared";
import type { PayrollItemDetail } from "@keystonehr/shared";

const STRINGS = {
  en: {
    payslip: "Payslip",
    employee: "Employee",
    role: "Role",
    period: "Pay Period",
    status: "Status",
    payDate: "Payment Date",
    earnings: "Earnings",
    baseSalary: "Base Salary",
    paidDays: "Paid for {paid} of {total} days",
    allowances: "Total Allowances",
    allowanceBreakdown: "Allowance Breakdown",
    additions: "Additional Earnings",
    gross: "Gross Pay",
    deductions: "Deductions",
    statutory: "Statutory Deductions",
    statutoryBreakdown: "Statutory Breakdown",
    other: "Other Deduction",
    absenceDeduction: "Absence Deduction",
    absentDaysNote: "{days} absent day(s) deducted",
    leaveDeduction: "Leave Deduction",
    unpaidDaysNote: "{days} unpaid day(s) deducted",
    extra: "Extra Deductions",
    totalDeductions: "Total Deductions",
    netPay: "Net Pay",
    generatedAt: "Generated",
    rejectionReason: "Rejection reason",
  },
  ar: {
    payslip: "قسيمة الراتب",
    employee: "الموظف",
    role: "الوظيفة",
    period: "فترة الراتب",
    status: "الحالة",
    payDate: "تاريخ الدفع",
    earnings: "الإيرادات",
    baseSalary: "الراتب الأساسي",
    paidDays: "مدفوع عن {paid} من {total} يوم",
    allowances: "إجمالي البدلات",
    allowanceBreakdown: "تفاصيل البدلات",
    additions: "إيرادات إضافية",
    gross: "إجمالي الراتب",
    deductions: "الاستقطاعات",
    statutory: "الاستقطاعات القانونية",
    statutoryBreakdown: "تفاصيل الاستقطاعات القانونية",
    other: "استقطاع آخر",
    absenceDeduction: "استقطاع الغياب",
    absentDaysNote: "تم خصم {days} يوم غياب",
    leaveDeduction: "استقطاع الإجازة",
    unpaidDaysNote: "تم خصم {days} يوم غير مدفوع",
    extra: "استقطاعات إضافية",
    totalDeductions: "إجمالي الاستقطاعات",
    netPay: "صافي الراتب",
    generatedAt: "تاريخ الإصدار",
    rejectionReason: "سبب الرفض",
  },
} as const;

const STATUS_LABEL: Record<PayrollItemDetail["status"], Record<"en" | "ar", string>> = {
  pending: { en: "Pending", ar: "قيد الانتظار" },
  approved: { en: "Approved", ar: "تمت الموافقة" },
  rejected: { en: "Rejected", ar: "مرفوض" },
  paid: { en: "Paid", ar: "تم الدفع" },
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}

/** `sub: true` renders a breakdown/ad-hoc line — smaller and muted, distinct from its parent total row. */
function row(label: string, amount: string, tone: "" | "positive" | "negative" = "", sub = false): string {
  const labelSpan = sub ? `<span class="muted-label">${escapeHtml(label)}</span>` : `<span>${escapeHtml(label)}</span>`;
  const amtClass = `amt ${tone}${sub ? " sub" : ""}`.trim();
  return `<div class="row">${labelSpan}<span class="${amtClass}">${escapeHtml(amount)}</span></div>`;
}

/** Small uppercase subhead above a breakdown/ad-hoc group — mirrors the section-title's typographic family but lighter. */
function subhead(label: string): string {
  return `<div class="subhead">${escapeHtml(label)}</div>`;
}

/**
 * Bilingual, print-friendly payslip — deliberately a light theme (not the
 * dark console theme) since it's meant to be printed/archived. Rendered to
 * PDF via headless Chromium (PayslipPdfService) so Arabic text shaping comes
 * from the browser's own text layout engine, not a JS PDF library.
 */
export function renderPayslipHtml(
  detail: PayrollItemDetail,
  locale: "en" | "ar",
  tenantName: string,
  useWesternNumerals = true,
): string {
  const t = STRINGS[locale];
  const dir = locale === "ar" ? "rtl" : "ltr";
  const fmt = (minor: number) => formatMoney(minor, detail.currency, locale, useWesternNumerals);
  const nameOf = (en: string, ar: string) => (locale === "ar" ? ar : en);

  const allowanceBreakdownHtml =
    detail.allowanceComponents.length > 0
      ? subhead(t.allowanceBreakdown) +
        detail.allowanceComponents.map((c) => row(nameOf(c.nameEn, c.nameAr), fmt(c.amountMinor), "", true)).join("")
      : "";
  const additionsHtml =
    detail.additions.length > 0
      ? subhead(t.additions) +
        detail.additions
          .map((a) => row(nameOf(a.labelEn, a.labelAr ?? a.labelEn), fmt(a.amountMinor), "positive", true))
          .join("")
      : "";
  const statutoryBreakdownHtml =
    detail.statutoryDeductionComponents.length > 0
      ? subhead(t.statutoryBreakdown) +
        detail.statutoryDeductionComponents
          .map((c) => row(nameOf(c.nameEn, c.nameAr), fmt(c.amountMinor), "negative", true))
          .join("")
      : "";
  const extraHtml =
    detail.extraDeductions.length > 0
      ? subhead(t.extra) +
        detail.extraDeductions
          .map((d) => row(nameOf(d.labelEn, d.labelAr ?? d.labelEn), fmt(d.amountMinor), "negative", true))
          .join("")
      : "";
  const paidDaysNote =
    detail.paidDays < detail.totalDaysInMonth
      ? `<p class="note">${escapeHtml(fillTemplate(t.paidDays, { paid: detail.paidDays, total: detail.totalDaysInMonth }))}</p>`
      : "";
  const absentDaysNote =
    detail.absenceDeductionMinor > 0
      ? `<p class="note">${escapeHtml(fillTemplate(t.absentDaysNote, { days: detail.absentDays }))}</p>`
      : "";
  const unpaidDaysNote =
    detail.leaveDeductionMinor > 0
      ? `<p class="note">${escapeHtml(fillTemplate(t.unpaidDaysNote, { days: detail.unpaidLeaveDays }))}</p>`
      : "";
  const payDateRow =
    detail.status === "paid" && detail.paidAt
      ? `<div><span>${t.payDate}</span><span>${escapeHtml(new Date(detail.paidAt).toISOString().slice(0, 10))}</span></div>`
      : "";

  const grossMinor =
    detail.baseSalaryMinor + detail.allowancesTotalMinor + detail.additionsTotalMinor;
  const totalDeductionsMinor =
    detail.statutoryDeductionsTotalMinor +
    detail.otherDeductionMinor +
    detail.absenceDeductionMinor +
    detail.leaveDeductionMinor +
    detail.extraDeductionsTotalMinor;

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
  .subhead { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #8b8f98; margin: 6px 0 4px; }
  .row { display: flex; justify-content: space-between; padding: 4px 0; }
  .muted-label { font-size: 11px; color: #6b6f78; }
  .note { font-size: 11px; color: #6b6f78; margin: 2px 0 0; }
  .amt { font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: isolate; }
  .amt.positive { color: #1f7a3d; }
  .amt.negative { color: #b3261e; }
  .amt.sub { font-size: 11px; }
  .total-row { display: flex; justify-content: space-between; border-top: 1px solid #d8dade; margin-top: 8px; padding-top: 8px; font-weight: 700; }
  .netpay { display: flex; justify-content: space-between; align-items: center; background: #fbf3e0; border: 1px solid #e7a81f; border-radius: 10px; padding: 14px 18px; margin: 16px 0; }
  .netpay .label { font-size: 14px; font-weight: 700; }
  .netpay .value { font-size: 22px; font-weight: 800; direction: ltr; unicode-bidi: isolate; }
  .footer { display: flex; justify-content: space-between; color: #6b6f78; font-size: 11px; margin-top: 18px; }
  .status-pill { display: inline-block; padding: 3px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; background: #eef1f5; }
</style>
</head>
<body>
  <h1>${escapeHtml(tenantName)}</h1>
  <p class="sub">${t.payslip} — ${escapeHtml(detail.payrollMonth)}</p>

  <div class="meta">
    <div><span>${t.employee}</span><span>${escapeHtml(detail.staff.name)}</span></div>
    <div><span>${t.role}</span><span>${escapeHtml(detail.staff.role ?? "—")}</span></div>
    <div><span>${t.period}</span><span>${escapeHtml(detail.payrollMonth)}</span></div>
    <div><span>${t.status}</span><span><span class="status-pill">${STATUS_LABEL[detail.status][locale]}</span></span></div>
    ${payDateRow}
  </div>

  <div class="card">
    <div class="section-title">${t.earnings}</div>
    ${row(t.baseSalary, fmt(detail.baseSalaryMinor))}
    ${paidDaysNote}
    ${row(t.allowances, fmt(detail.allowancesTotalMinor))}
    ${allowanceBreakdownHtml}
    ${additionsHtml}
    <div class="total-row"><span>${t.gross}</span><span class="amt">${fmt(grossMinor)}</span></div>
  </div>

  <div class="card">
    <div class="section-title">${t.deductions}</div>
    ${row(t.statutory, fmt(detail.statutoryDeductionsTotalMinor), "negative")}
    ${statutoryBreakdownHtml}
    ${row(t.other, fmt(detail.otherDeductionMinor), "negative")}
    ${detail.absenceDeductionMinor > 0 ? row(t.absenceDeduction, fmt(detail.absenceDeductionMinor), "negative") : ""}
    ${absentDaysNote}
    ${detail.leaveDeductionMinor > 0 ? row(t.leaveDeduction, fmt(detail.leaveDeductionMinor), "negative") : ""}
    ${unpaidDaysNote}
    ${extraHtml}
    <div class="total-row"><span>${t.totalDeductions}</span><span class="amt negative">${fmt(totalDeductionsMinor)}</span></div>
  </div>

  <div class="netpay">
    <span class="label">${t.netPay}</span>
    <span class="value">${fmt(detail.netPayMinor)}</span>
  </div>

  ${
    detail.status === "rejected" && detail.rejectionReason
      ? `<p class="sub">${t.rejectionReason}: ${escapeHtml(detail.rejectionReason)}</p>`
      : ""
  }

  <div class="footer">
    <span>${t.generatedAt}: ${new Date().toISOString().slice(0, 10)}</span>
  </div>
</body>
</html>`;
}

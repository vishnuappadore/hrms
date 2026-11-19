"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { fromMinorUnits, formatMoney, toMinorUnits, type PayrollItemDetail } from "@keystonehr/shared";
import { Briefcase, Building2, CalendarDays, Download, MoreVertical, Pencil, Plus, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { usePermissions } from "@/lib/permissions";
import {
  downloadPayslipPdf,
  useEditPayrollItem,
  useMarkPayrollItemPaid,
  usePayrollItem,
  useRecomputePayrollItem,
  useRejectPayrollItem,
  useRevertPayrollItem,
} from "@/lib/queries/payroll";
import { canApprove, canEdit, canMarkPaid, canReject, canRecompute, canRevert, statusBadgeVariant } from "./payroll-status";

interface EditableRow {
  labelEn: string;
  amount: string;
}

function monthYearLabel(month: string, locale: string): string {
  return new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function PayslipDialog({
  itemId,
  runId,
  onClose,
  onApprove,
}: {
  itemId: string | null;
  runId: string;
  onClose: () => void;
  /** Approve goes through the same confirm dialog as the table's row-level Approve — handled by the parent. */
  onApprove?: (item: PayrollItemDetail) => void;
}) {
  const t = useTranslations("payroll.slip");
  const tp = useTranslations("payroll");
  const tc = useTranslations("common");
  const locale = useLocale();
  const permissions = usePermissions();

  const { data: detail } = usePayrollItem(itemId ?? undefined);
  const editMutation = useEditPayrollItem(runId);
  const rejectMutation = useRejectPayrollItem(runId);
  const markPaidMutation = useMarkPayrollItemPaid(runId);
  const revertMutation = useRevertPayrollItem(runId);
  const recomputeMutation = useRecomputePayrollItem(runId);

  const [editMode, setEditMode] = useState(false);
  const [allowancesValue, setAllowancesValue] = useState("0");
  const [statutoryValue, setStatutoryValue] = useState("0");
  const [otherValue, setOtherValue] = useState("0");
  const [absenceValue, setAbsenceValue] = useState("0");
  const [leaveValue, setLeaveValue] = useState("0");
  const [additions, setAdditions] = useState<EditableRow[]>([]);
  const [extraDeductions, setExtraDeductions] = useState<EditableRow[]>([]);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  function close() {
    setEditMode(false);
    setRejecting(false);
    setReason("");
    onClose();
  }

  function startEdit() {
    if (!detail) return;
    setAllowancesValue(String(fromMinorUnits(detail.allowancesTotalMinor, detail.currency)));
    setStatutoryValue(String(fromMinorUnits(detail.statutoryDeductionsTotalMinor, detail.currency)));
    setOtherValue(String(fromMinorUnits(detail.otherDeductionMinor, detail.currency)));
    setAbsenceValue(String(fromMinorUnits(detail.absenceDeductionMinor, detail.currency)));
    setLeaveValue(String(fromMinorUnits(detail.leaveDeductionMinor, detail.currency)));
    setAdditions(
      detail.additions.map((a) => ({
        labelEn: a.labelEn,
        amount: String(fromMinorUnits(a.amountMinor, detail.currency)),
      })),
    );
    setExtraDeductions(
      detail.extraDeductions.map((d) => ({
        labelEn: d.labelEn,
        amount: String(fromMinorUnits(d.amountMinor, detail.currency)),
      })),
    );
    setEditMode(true);
  }

  async function save() {
    if (!detail) return;
    const toRows = (rows: EditableRow[]) =>
      rows
        .filter((r) => r.labelEn.trim().length > 0)
        .map((r) => ({ labelEn: r.labelEn.trim(), amountMinor: toMinorUnits(Number(r.amount) || 0, detail.currency) }));

    await editMutation.mutateAsync({
      itemId: detail.id,
      input: {
        allowancesTotalMinor: toMinorUnits(Number(allowancesValue) || 0, detail.currency),
        statutoryDeductionsTotalMinor: toMinorUnits(Number(statutoryValue) || 0, detail.currency),
        otherDeductionMinor: toMinorUnits(Number(otherValue) || 0, detail.currency),
        absenceDeductionMinor: toMinorUnits(Number(absenceValue) || 0, detail.currency),
        leaveDeductionMinor: toMinorUnits(Number(leaveValue) || 0, detail.currency),
        additions: toRows(additions),
        extraDeductions: toRows(extraDeductions),
      },
    });
    setEditMode(false);
  }

  async function confirmReject() {
    if (!detail) return;
    await rejectMutation.mutateAsync({ itemId: detail.id, reason: reason || undefined });
    setRejecting(false);
    setReason("");
  }

  if (!detail) {
    return (
      <Dialog
        open={itemId !== null}
        onClose={close}
        title={t("title", { name: "" })}
        className="max-w-3xl"
        showCloseButton
        closeLabel={tc("close")}
      >
        <p className="text-sm text-muted-foreground">{tc("loading")}</p>
      </Dialog>
    );
  }

  const fmt = (minor: number) => formatMoney(minor, detail.currency, locale);
  const localizedName = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const gross = detail.baseSalaryMinor + detail.allowancesTotalMinor + detail.additionsTotalMinor;
  const totalDeductions =
    detail.statutoryDeductionsTotalMinor +
    detail.otherDeductionMinor +
    detail.absenceDeductionMinor +
    detail.leaveDeductionMinor +
    detail.extraDeductionsTotalMinor;

  return (
    <Dialog
      open={itemId !== null}
      onClose={close}
      title={`${t("title", { name: detail.employee.name })} · ${monthYearLabel(detail.payrollMonth, locale)}`}
      className="max-w-3xl"
      showCloseButton
      closeLabel={tc("close")}
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pe-1">
        <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-muted/30 p-4">
          <div className="flex items-start gap-3">
            <Avatar name={detail.employee.name} className="h-14 w-14 text-base" />
            <div>
              <div className="text-base font-semibold text-foreground">{detail.employee.name}</div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Briefcase className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                  {detail.employee.role ?? "—"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                  {localizedName(detail.employee.branchNameEn, detail.employee.branchNameAr)}
                </span>
                {detail.employee.joiningDate && (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                    {t("doj")}: {new Date(detail.employee.joiningDate).toLocaleDateString(locale)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <Badge variant={statusBadgeVariant(detail.status)}>{tp(`status.${detail.status}`)}</Badge>
              <DropdownMenu
                trigger={<MoreVertical className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />}
                triggerLabel={tc("moreActions")}
              >
                {!editMode && canEdit(detail.status) && permissions.includes("payroll.edit") && (
                  <DropdownMenuItem onSelect={startEdit}>
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                    {tc("edit")}
                  </DropdownMenuItem>
                )}
                {!editMode && canRecompute(detail.status) && permissions.includes("payroll.edit") && (
                  <DropdownMenuItem
                    disabled={recomputeMutation.isPending}
                    onSelect={() => recomputeMutation.mutate({ itemId: detail.id })}
                  >
                    <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                    {tp("actionsLabel.recompute")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => downloadPayslipPdf(detail.id, locale, `payslip-${detail.payrollMonth}`)}>
                  <Download className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                  {t("downloadPdf")}
                </DropdownMenuItem>
              </DropdownMenu>
            </div>
            {detail.status === "paid" && detail.paidAt && (
              <span className="text-[11px] text-muted-foreground">
                {t("payDate")}: {new Date(detail.paidAt).toLocaleDateString(locale)}
              </span>
            )}
          </div>
        </div>

        <section>
          <h3 className="mb-2 border-b border-border pb-1.5 text-xs font-semibold uppercase tracking-wide text-positive">
            {t("earnings")}
          </h3>
          <div className="space-y-1.5 text-[12.5px]">
            <div>
              <Row label={t("baseSalary")} value={fmt(detail.baseSalaryMinor)} positive />
              {detail.paidDays < detail.totalDaysInMonth && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t("paidDays", { paid: detail.paidDays, total: detail.totalDaysInMonth })}
                </p>
              )}
            </div>

            {editMode ? (
              <AmountField label={t("allowances")} value={allowancesValue} onChange={setAllowancesValue} />
            ) : (
              <Row label={t("allowances")} value={fmt(detail.allowancesTotalMinor)} positive />
            )}
            {detail.allowanceComponents.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/30 p-2.5">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("allowanceBreakdown")}
                </div>
                {detail.allowanceComponents.map((c, i) => (
                  <Row key={i} label={localizedName(c.nameEn, c.nameAr)} value={fmt(c.amountMinor)} muted positive />
                ))}
              </div>
            )}

            {editMode ? (
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("additions")}
                </div>
                <AdjustmentList
                  rows={additions}
                  setRows={setAdditions}
                  addLabel={t("addAddition")}
                  placeholder={t("labelPlaceholder")}
                />
              </div>
            ) : (
              detail.additions.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("additions")}
                  </div>
                  <AdjustmentReadList rows={detail.additions} tone="positive" fmt={fmt} />
                </div>
              )
            )}

            <Row label={t("gross")} value={fmt(gross)} strong positive divider />
          </div>
        </section>

        <section>
          <h3 className="mb-2 border-b border-border pb-1.5 text-xs font-semibold uppercase tracking-wide text-destructive">
            {t("deductions")}
          </h3>
          <div className="space-y-1.5 text-[12.5px]">
            {editMode ? (
              <AmountField label={t("statutory")} value={statutoryValue} onChange={setStatutoryValue} />
            ) : (
              <Row label={t("statutory")} value={fmt(detail.statutoryDeductionsTotalMinor)} negative />
            )}
            {detail.statutoryDeductionComponents.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/30 p-2.5">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("statutoryBreakdown")}
                </div>
                {detail.statutoryDeductionComponents.map((c, i) => (
                  <Row key={i} label={localizedName(c.nameEn, c.nameAr)} value={fmt(c.amountMinor)} muted negative />
                ))}
              </div>
            )}

            {editMode ? (
              <AmountField label={t("other")} value={otherValue} onChange={setOtherValue} />
            ) : (
              <Row label={t("other")} value={fmt(detail.otherDeductionMinor)} negative />
            )}

            {editMode ? (
              <AmountField label={t("absenceDeduction")} value={absenceValue} onChange={setAbsenceValue} />
            ) : (
              detail.absenceDeductionMinor > 0 && (
                <div>
                  <Row label={t("absenceDeduction")} value={fmt(detail.absenceDeductionMinor)} negative />
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {t("absentDaysNote", { days: detail.absentDays })}
                  </p>
                </div>
              )
            )}

            {editMode ? (
              <AmountField label={t("leaveDeduction")} value={leaveValue} onChange={setLeaveValue} />
            ) : (
              detail.leaveDeductionMinor > 0 && (
                <div>
                  <Row label={t("leaveDeduction")} value={fmt(detail.leaveDeductionMinor)} negative />
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {t("unpaidDaysNote", { days: detail.unpaidLeaveDays })}
                  </p>
                </div>
              )
            )}

            {editMode ? (
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("extraDeductions")}
                </div>
                <AdjustmentList
                  rows={extraDeductions}
                  setRows={setExtraDeductions}
                  addLabel={t("addDeduction")}
                  placeholder={t("labelPlaceholder")}
                />
              </div>
            ) : (
              detail.extraDeductions.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("extraDeductions")}
                  </div>
                  <AdjustmentReadList rows={detail.extraDeductions} tone="negative" fmt={fmt} />
                </div>
              )
            )}

            <Row label={t("totalDeductions")} value={fmt(totalDeductions)} strong negative divider />
          </div>
        </section>

        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">{t("netPay")}</span>
          <span className="text-xl font-bold text-primary">{fmt(detail.netPayMinor)}</span>
        </div>

        {detail.status === "rejected" && detail.rejectionReason && (
          <p className="text-sm text-muted-foreground">
            {t("rejectionReason")}: {detail.rejectionReason}
          </p>
        )}

        {rejecting ? (
          <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={tp("confirm.reasonLabel")}
            />
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setRejecting(false)}>
                {tc("cancel")}
              </Button>
              <Button variant="destructive" size="sm" disabled={rejectMutation.isPending} onClick={confirmReject}>
                {tp("confirm.confirmReject")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
            {editMode && (
              <Button variant="outline" disabled={editMutation.isPending} onClick={save}>
                {editMutation.isPending ? tc("saving") : tc("save")}
              </Button>
            )}
            {!editMode && canApprove(detail.status) && permissions.includes("payroll.approve") && (
              <Button onClick={() => onApprove?.(detail)}>{tp("actionsLabel.approve")}</Button>
            )}
            {!editMode && canRevert(detail.status) && permissions.includes("payroll.approve") && (
              <Button variant="outline" disabled={revertMutation.isPending} onClick={() => revertMutation.mutate({ itemId: detail.id })}>
                {tp("actionsLabel.revert")}
              </Button>
            )}
            {!editMode && canReject(detail.status) && permissions.includes("payroll.reject") && (
              <Button variant="destructive" onClick={() => setRejecting(true)}>
                {tp("actionsLabel.reject")}
              </Button>
            )}
            {!editMode && canMarkPaid(detail.status) && permissions.includes("payroll.mark_paid") && (
              <Button disabled={markPaidMutation.isPending} onClick={() => markPaidMutation.mutate({ itemId: detail.id })}>
                {tp("actionsLabel.markPaid")}
              </Button>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Row({
  label,
  value,
  muted,
  strong,
  positive,
  negative,
  divider,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
  positive?: boolean;
  negative?: boolean;
  /** Sets this row apart as a computed subtotal, distinct from the line items above it. */
  divider?: boolean;
}) {
  return (
    <div className={cn("flex items-center justify-between", divider && "mt-1 border-t border-border pt-2")}>
      <span className={cn(muted && "text-[11px]", "text-muted-foreground")}>{label}</span>
      <span
        className={cn(
          muted && "text-[11px]",
          strong && "font-semibold",
          negative ? "text-destructive" : positive ? "text-positive" : "text-foreground",
        )}
      >
        {negative ? `− ${value}` : value}
      </span>
    </div>
  );
}

function AmountField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type="number"
        min={0}
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-28 text-end"
      />
    </div>
  );
}

/** Read-only ad-hoc rows, sourced straight from the saved detail — never the edit-draft state. */
function AdjustmentReadList({
  rows,
  tone,
  fmt,
}: {
  rows: { labelEn: string; amountMinor: number }[];
  tone: "positive" | "negative";
  fmt: (minor: number) => string;
}) {
  return (
    <>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">{r.labelEn}</span>
          <span className={cn("text-[11px]", tone === "positive" ? "text-positive" : "text-destructive")}>
            {tone === "positive" ? "+ " : "− "}
            {fmt(r.amountMinor)}
          </span>
        </div>
      ))}
    </>
  );
}

function AdjustmentList({
  rows,
  setRows,
  addLabel,
  placeholder,
}: {
  rows: EditableRow[];
  setRows: (updater: (prev: EditableRow[]) => EditableRow[]) => void;
  addLabel: string;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={row.labelEn}
            placeholder={placeholder}
            onChange={(e) =>
              setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, labelEn: e.target.value } : r)))
            }
            className="flex-1"
          />
          <Input
            type="number"
            min={0}
            step="any"
            value={row.amount}
            onChange={(e) =>
              setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, amount: e.target.value } : r)))
            }
            className="w-24 text-end"
          />
          <button
            type="button"
            aria-label="remove"
            onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows((prev) => [...prev, { labelEn: "", amount: "0" }])}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary-muted px-2.5 py-1.5 text-xs font-medium text-primary"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        {addLabel}
      </button>
    </div>
  );
}

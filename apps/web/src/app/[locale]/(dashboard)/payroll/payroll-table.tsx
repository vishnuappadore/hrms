"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatMoney, type PayrollItemSummary } from "@keystonehr/shared";
import { Check, ChevronLeft, ChevronRight, CircleCheck, CircleX, FileText, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { type ListMeta } from "@/components/data-table";
import { statusBadgeVariant } from "./payroll-status";

export interface PayrollRowActions {
  canApprove?: boolean;
  canReject?: boolean;
  canMarkPaid?: boolean;
  canRevert?: boolean;
}

interface PayrollTableProps {
  items: PayrollItemSummary[];
  emptyLabel: string;
  selection?: {
    isSelected: (itemId: string) => boolean;
    onToggle: (itemId: string) => void;
    onToggleAll: () => void;
  };
  pagination?: {
    meta: ListMeta;
    onPageChange: (page: number) => void;
  };
  rowActions: (item: PayrollItemSummary) => PayrollRowActions;
  onViewPayslip: (itemId: string) => void;
  onApprove?: (item: PayrollItemSummary) => void;
  onReject?: (item: PayrollItemSummary) => void;
  onMarkPaid?: (itemId: string) => void;
  onRevert?: (itemId: string) => void;
}

export function PayrollTable({
  items,
  emptyLabel,
  selection,
  pagination,
  rowActions,
  onViewPayslip,
  onApprove,
  onReject,
  onMarkPaid,
  onRevert,
}: PayrollTableProps) {
  const t = useTranslations("payroll");
  const tTable = useTranslations("table");
  const locale = useLocale();

  const deductionsOf = (i: PayrollItemSummary) =>
    i.statutoryDeductionsTotalMinor +
    i.otherDeductionMinor +
    i.absenceDeductionMinor +
    i.leaveDeductionMinor +
    i.extraDeductionsTotalMinor;
  const allowancesOf = (i: PayrollItemSummary) => i.allowancesTotalMinor + i.additionsTotalMinor;

  const totals = items.reduce(
    (acc, i) => ({
      base: acc.base + i.baseSalaryMinor,
      allowances: acc.allowances + allowancesOf(i),
      deductions: acc.deductions + deductionsOf(i),
      net: acc.net + i.netPayMinor,
    }),
    { base: 0, allowances: 0, deductions: 0, net: 0 },
  );
  const currency = items[0]?.currency ?? "AED";
  const allSelected = selection ? items.length > 0 && items.every((i) => selection.isSelected(i.id)) : false;
  const pages = pagination ? Math.max(1, Math.ceil(pagination.meta.total / pagination.meta.pageSize)) : 1;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-start text-[10.5px] font-medium text-muted-foreground">
              {selection && (
                <th className="w-10 px-4 py-3">
                  <Checkbox checked={allSelected} onChange={selection.onToggleAll} aria-label={t("bulk.selected", { count: items.length })} />
                </th>
              )}
              <th className="px-4 py-3 text-start">{t("columns.employee")}</th>
              <th className="px-4 py-3 text-end">{t("columns.base")}</th>
              <th className="px-4 py-3 text-end">{t("columns.allowances")}</th>
              <th className="px-4 py-3 text-end">{t("columns.deductions")}</th>
              <th className="px-4 py-3 text-end">{t("columns.net")}</th>
              <th className="px-4 py-3 text-start">{t("columns.status")}</th>
              <th className="px-4 py-3 text-end">{t("columns.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const actions = rowActions(item);
                return (
                  <tr key={item.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    {selection && (
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={selection.isSelected(item.id)}
                          onChange={() => selection.onToggle(item.id)}
                          aria-label={item.employee.name}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={item.employee.name} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">{item.employee.name}</div>
                          <div className="truncate text-[10.5px] text-muted-foreground">{item.employee.role ?? "—"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-end">
                      {formatMoney(item.baseSalaryMinor, item.currency, locale)}
                      {item.paidDays < item.totalDaysInMonth && (
                        <div className="text-[10px] text-muted-foreground">
                          {t("paidDaysShort", { paid: item.paidDays, total: item.totalDaysInMonth })}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-end">
                      {formatMoney(allowancesOf(item), item.currency, locale)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-end text-destructive">
                      {formatMoney(deductionsOf(item), item.currency, locale)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-end font-semibold text-foreground">
                      {formatMoney(item.netPayMinor, item.currency, locale)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusBadgeVariant(item.status)}>{t(`status.${item.status}`)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <RowIconButton
                          label={t("actionsLabel.viewPayslip")}
                          onClick={() => onViewPayslip(item.id)}
                          tone="info"
                        >
                          <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </RowIconButton>
                        {actions.canApprove && onApprove && (
                          <RowIconButton label={t("actionsLabel.approve")} onClick={() => onApprove(item)} tone="success">
                            <CircleCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </RowIconButton>
                        )}
                        {actions.canMarkPaid && onMarkPaid && (
                          <RowIconButton label={t("actionsLabel.markPaid")} onClick={() => onMarkPaid(item.id)} tone="success">
                            <Check className="h-3.5 w-3.5" strokeWidth={2} />
                          </RowIconButton>
                        )}
                        {actions.canReject && onReject && (
                          <RowIconButton label={t("actionsLabel.reject")} onClick={() => onReject(item)} tone="destructive">
                            <CircleX className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </RowIconButton>
                        )}
                        {actions.canRevert && onRevert && (
                          <RowIconButton label={t("actionsLabel.revert")} onClick={() => onRevert(item.id)} tone="neutral">
                            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </RowIconButton>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr className="border-t border-border bg-muted/30 font-semibold">
                {selection && <td className="px-4 py-3" />}
                <td className="px-4 py-3 uppercase tracking-wide text-[10.5px] text-muted-foreground">
                  {t("totals")} · {items.length}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-end">{formatMoney(totals.base, currency, locale)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-end">{formatMoney(totals.allowances, currency, locale)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-end text-destructive">
                  {formatMoney(totals.deductions, currency, locale)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-end">{formatMoney(totals.net, currency, locale)}</td>
                <td />
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {pagination && pagination.meta.total > 0 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-sm text-muted-foreground">
          <span>{tTable("totalRows", { total: pagination.meta.total })}</span>
          <div className="flex items-center gap-1.5">
            <IconButton
              label={tTable("previous")}
              disabled={pagination.meta.page <= 1}
              onClick={() => pagination.onPageChange(pagination.meta.page - 1)}
            >
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
            <span className="px-1 tabular-nums">{tTable("pageOf", { page: pagination.meta.page, pages })}</span>
            <IconButton
              label={tTable("next")}
              disabled={pagination.meta.page >= pages}
              onClick={() => pagination.onPageChange(pagination.meta.page + 1)}
            >
              <ChevronRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
      )}
    </div>
  );
}

function RowIconButton({
  label,
  onClick,
  tone,
  children,
}: {
  label: string;
  onClick: () => void;
  tone: "info" | "success" | "destructive" | "neutral";
  children: React.ReactNode;
}) {
  const toneClass = {
    info: "bg-info/10 text-info",
    success: "bg-positive/10 text-positive",
    destructive: "bg-destructive/10 text-destructive",
    neutral: "bg-muted text-foreground",
  }[tone];
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg transition hover:brightness-110",
        toneClass,
      )}
    >
      {children}
    </button>
  );
}

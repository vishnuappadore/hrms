"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { fromMinorUnits, toMinorUnits } from "@keystonehr/shared";
import type { PayrollComponent, PayrollComponentBasis, PayrollComponentCategory } from "@keystonehr/shared";
import { ApiError } from "@/lib/api-client";
import { usePermissions } from "@/lib/permissions";
import { BackLink } from "@/components/back-link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMe } from "@/lib/queries/users";
import { usePayrollComponents, useSavePayrollComponents } from "@/lib/queries/payroll-components";

interface ComponentRow {
  id?: string;
  nameEn: string;
  nameAr: string;
  basis: PayrollComponentBasis;
  /** display string — OMR major units if basis is fixed_amount, a plain percent otherwise */
  value: string;
}

function toRow(component: PayrollComponent, currency: string): ComponentRow {
  return {
    id: component.id,
    nameEn: component.nameEn,
    nameAr: component.nameAr,
    basis: component.basis,
    value:
      component.basis === "fixed_amount"
        ? String(fromMinorUnits(component.defaultAmountMinor ?? 0, currency))
        : String(component.defaultRatePct ?? 0),
  };
}

export function PayrollComponentsContent() {
  const t = useTranslations("settings.payrollComponents");
  const { data: me } = useMe();
  const currency = me?.currency ?? "OMR";

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <BackLink href="/settings" label={t("backToSettings")} bare />
        </div>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <ComponentSection category="allowance" currency={currency} />
      <ComponentSection category="deduction" currency={currency} />
    </div>
  );
}

function ComponentSection({
  category,
  currency,
}: {
  category: PayrollComponentCategory;
  currency: string;
}) {
  const t = useTranslations("settings.payrollComponents");
  const tc = useTranslations("common");
  const { data } = usePayrollComponents(category);
  const save = useSavePayrollComponents(category);
  const permissions = usePermissions();
  const canManage = permissions.includes("settings.manage");
  const [rows, setRows] = useState<ComponentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data && rows === null) setRows(data.map((c) => toRow(c, currency)));
  }, [data, rows, currency]);

  function updateRow(index: number, patch: Partial<ComponentRow>) {
    setRows((prev) => prev?.map((row, i) => (i === index ? { ...row, ...patch } : row)) ?? prev);
  }

  function addRow() {
    setRows((prev) => [
      ...(prev ?? []),
      { nameEn: "", nameAr: "", basis: "fixed_amount", value: "" },
    ]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev?.filter((_, i) => i !== index) ?? prev);
  }

  function toggleBasis(index: number) {
    updateRow(index, {
      basis: rows?.[index]?.basis === "fixed_amount" ? "percentage_of_base" : "fixed_amount",
    });
  }

  async function handleSave() {
    if (!rows) return;
    setError(null);
    try {
      const saved = await save.mutateAsync({
        items: rows.map((row) => {
          const value = Number(row.value) || 0;
          return {
            id: row.id,
            nameEn: row.nameEn.trim(),
            nameAr: row.nameAr.trim(),
            basis: row.basis,
            defaultAmountMinor: row.basis === "fixed_amount" ? toMinorUnits(value, currency) : null,
            defaultRatePct: row.basis === "percentage_of_base" ? value : null,
          };
        }),
      });
      setRows(saved.map((c) => toRow(c, currency)));
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "NETWORK";
      setError(code === "NAME_EXISTS" ? t("nameExists") : tc("errors.GENERIC"));
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t(`${category}.title`)}</h2>
          <p className="text-xs text-muted-foreground">{t(`${category}.hint`)}</p>
        </div>
        {canManage && (
          <Button variant="outline" size="sm" type="button" onClick={addRow}>
            {t("add")}
          </Button>
        )}
      </div>

      {rows === null ? (
        <p className="text-sm text-muted-foreground">{tc("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="space-y-2">
          <div className="hidden gap-3 px-1 text-[11px] font-medium text-muted-foreground sm:grid sm:grid-cols-[1fr_1fr_7rem_5rem_2rem]">
            <span>{t("nameEn")}</span>
            <span>{t("nameAr")}</span>
            <span>{t("defaultValue")}</span>
            <span>{t("basis")}</span>
            <span />
          </div>
          {rows.map((row, index) => (
            <div
              key={row.id ?? `new-${index}`}
              className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_1fr_7rem_5rem_2rem]"
            >
              <Input
                aria-label={t("nameEn")}
                dir="ltr"
                value={row.nameEn}
                onChange={(e) => updateRow(index, { nameEn: e.target.value })}
              />
              <Input
                aria-label={t("nameAr")}
                dir="rtl"
                value={row.nameAr}
                onChange={(e) => updateRow(index, { nameAr: e.target.value })}
              />
              <Input
                aria-label={t("defaultValue")}
                type="number"
                min={0}
                step="any"
                value={row.value}
                onChange={(e) => updateRow(index, { value: e.target.value })}
              />
              {canManage && (
                <Button variant="outline" size="sm" type="button" onClick={() => toggleBasis(index)}>
                  {row.basis === "fixed_amount" ? t("fixed") : "%"}
                </Button>
              )}
              {canManage && (
                <Button
                  variant="destructive"
                  size="sm"
                  type="button"
                  aria-label={tc("remove")}
                  onClick={() => removeRow(index)}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <Alert className="mt-3">{error}</Alert>}

      {canManage && (
        <div className="mt-4 flex justify-end">
          <Button type="button" disabled={save.isPending || rows === null} onClick={handleSave}>
            {save.isPending ? tc("saving") : t("saveChanges")}
          </Button>
        </div>
      )}
    </section>
  );
}

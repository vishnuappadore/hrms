"use client";

import type { Branch } from "@keystonehr/shared";
import { MapPin, UserRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";

/**
 * Card representation of a branch for the grid view, mirroring the approved
 * console design.
 */
export function BranchCard({ branch }: { branch: Branch }) {
  const t = useTranslations("branches");
  const tc = useTranslations("common");
  const locale = useLocale();
  const name = locale === "ar" ? branch.nameAr : branch.nameEn;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-muted text-primary">
          <MapPin className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{branch.city}</p>
        </div>
        <Badge variant={branch.status === "active" ? "success" : "destructive"}>
          {tc(branch.status)}
        </Badge>
      </div>

      <div className="flex items-center gap-2 border-b border-border pb-4 text-sm text-muted-foreground">
        <UserRound className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span className="truncate">
          {branch.manager?.name ?? <span className="italic">{t("card.noManager")}</span>}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("list.employees")}</dt>
          <dd className="font-semibold tabular-nums">{branch.employeeCount}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("form.currency")}</dt>
          <dd className="font-semibold tabular-nums">{branch.currency}</dd>
        </div>
      </dl>

      <div className="flex items-center justify-end pt-1">
        <Link
          href={`/branches/${branch.id}`}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium transition hover:bg-muted"
        >
          {t("card.viewDetails")}
        </Link>
      </div>
    </div>
  );
}

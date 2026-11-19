"use client";

import type { Branch } from "@keystonehr/shared";
import { MapPin, Star, UserRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";

/** Metrics that join with their modules later (revenue/appointments/
 *  utilization/rating). Rendered as a muted em dash until then — no fake data. */
const EMPTY = "—";

/**
 * Card representation of a branch for the grid view, mirroring the approved
 * console design. Staff count, chair count (+ name/city/status/manager) are
 * backed by data today; the remaining metrics show `EMPTY` until their
 * modules land.
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
          <dt className="text-xs text-muted-foreground">{t("card.revenueToday")}</dt>
          <dd className="font-semibold text-primary">{EMPTY}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("card.appointments")}</dt>
          <dd className="font-semibold">{EMPTY}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("list.staff")}</dt>
          <dd className="font-semibold tabular-nums">{branch.staffCount}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("card.chairs")}</dt>
          <dd className="font-semibold tabular-nums">{branch.chairCount}</dd>
        </div>
      </dl>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
          <span>{t("card.utilization")}</span>
          <span>{EMPTY}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true" />
      </div>

      <div className="flex items-center justify-between pt-1">
        <span className="flex items-center gap-1 text-sm font-semibold">
          <Star className="h-4 w-4 text-primary" strokeWidth={1.75} aria-hidden="true" />
          {EMPTY}
        </span>
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

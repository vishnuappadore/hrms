"use client";

import { useLocale, useTranslations } from "next-intl";
import { Check, Download, Pencil, Play, ShoppingCart, X } from "lucide-react";
import { formatMoney, type WalkIn } from "@keystonehr/shared";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { usePermissions } from "@/lib/permissions";
import { useAppointmentBarbers } from "@/lib/queries/appointments";
import { downloadInvoicePdf } from "@/lib/queries/pos";
import { useAssignWalkInBarber, useWalkInAction } from "@/lib/queries/walk-ins";
import { STATUS_BADGE, useWaitLabel } from "./walk-in-queue";

/**
 * Read-only profile for a single queue entry, reused by the Add Walk-in
 * drawer's "view" mode. Status/barber controls are the SAME hooks the
 * List/Board already use (useAssignWalkInBarber/useWalkInAction) wired up
 * again here, so this view is functional, not just a summary.
 */
export function WalkInDetailView({ entry, onEdit }: { entry: WalkIn; onEdit: () => void }) {
  const t = useTranslations("walkIn");
  const tc = useTranslations("common");
  const locale = useLocale();
  const permissions = usePermissions();

  const barbersQuery = useAppointmentBarbers(entry.branchId);
  const barbers = barbersQuery.data ?? [];
  const assignBarber = useAssignWalkInBarber();
  const action = useWalkInAction();
  useWaitLabel(entry.queuedAt); // keeps this view live-ticking while open, same cadence as the list

  const displayName = entry.customer?.name ?? entry.customerName ?? t("list.guest");
  const mobile = entry.customer?.mobile ?? entry.mobileNumber;
  const branchName = locale === "ar" ? entry.branch.nameAr : entry.branch.nameEn;
  const editable = entry.status === "waiting" || entry.status === "serving";
  const queuedAtLabel = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(entry.queuedAt));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Badge variant={STATUS_BADGE[entry.status]}>{t(`status.${entry.status}`)}</Badge>
          <span dir="ltr" className="text-sm text-muted-foreground">
            {queuedAtLabel}
          </span>
        </div>
        {editable && permissions.includes("walkin.update") ? (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium transition hover:bg-muted"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
            {tc("edit")}
          </button>
        ) : null}
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">{t("detail.customer")}</dt>
          <dd className="mt-0.5">
            <span className="font-medium">{displayName}</span>
            {mobile ? (
              <>
                {" "}
                <span dir="ltr" className="text-muted-foreground">
                  {mobile}
                </span>
              </>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("branch")}</dt>
          <dd className="mt-0.5 font-medium">{branchName}</dd>
        </div>
      </dl>

      <div>
        <h3 className="mb-0.5 text-xs text-muted-foreground">{t("list.barber")}</h3>
        {editable && permissions.includes("walkin.update") ? (
          <Select
            aria-label={t("list.barber")}
            value={entry.barberStaffId ?? ""}
            onChange={(e) =>
              assignBarber.mutate({ id: entry.id, input: { barberStaffId: e.target.value || null } })
            }
          >
            <option value="">{t("list.unassigned")}</option>
            {barbers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        ) : (
          <p className="text-sm">{entry.barber?.name ?? t("list.unassigned")}</p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{t("form.services")}</div>
        {entry.services.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("detail.noServices")}</p>
        ) : (
          <ul className="space-y-1.5">
            {entry.services.map((s) => (
              <li key={s.serviceId} className="flex items-center justify-between gap-3">
                <span>{locale === "ar" ? s.nameAr : s.nameEn}</span>
                <span className="whitespace-nowrap text-muted-foreground">
                  {formatMoney(s.priceMinor, entry.currency, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2 font-semibold">
          <span>{t("form.total")}</span>
          <span>{formatMoney(entry.totalMinor, entry.currency, locale)}</span>
        </div>
      </div>

      {editable || entry.invoiceId ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          {!editable && entry.invoiceId ? (
            permissions.includes("invoices.view") && (
              <button
                type="button"
                onClick={() => downloadInvoicePdf(entry.invoiceId!, locale, entry.id)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3.5 text-sm font-medium transition hover:bg-muted"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t("actions.downloadInvoice")}
              </button>
            )
          ) : entry.status === "waiting" ? (
            <>
              {permissions.includes("walkin.checkin") && (
                <button
                  type="button"
                  onClick={() => action.mutate({ id: entry.id, action: "start" })}
                  disabled={action.isPending}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-tint-info-border bg-tint-info-bg px-3.5 text-sm font-medium text-info transition hover:brightness-110 disabled:opacity-60"
                >
                  <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {t("actions.start")}
                </button>
              )}
              {permissions.includes("walkin.cancel") && (
                <button
                  type="button"
                  onClick={() => action.mutate({ id: entry.id, action: "cancel" })}
                  disabled={action.isPending}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-tint-destructive-border bg-tint-destructive-bg px-3.5 text-sm font-medium text-destructive transition hover:brightness-110 disabled:opacity-60"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {t("actions.cancel")}
                </button>
              )}
            </>
          ) : (
            <>
              {permissions.includes("pos.use") && (
                <Link
                  href={`/pos?walkInId=${entry.id}`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-tint-warning-border bg-tint-warning-bg px-3.5 text-sm font-medium text-warning transition hover:brightness-110"
                >
                  <ShoppingCart className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {t("actions.checkout")}
                </Link>
              )}
              {permissions.includes("walkin.checkin") && (
                <button
                  type="button"
                  onClick={() => action.mutate({ id: entry.id, action: "complete" })}
                  disabled={action.isPending}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-tint-positive-border bg-tint-positive-bg px-3.5 text-sm font-medium text-positive transition hover:brightness-110 disabled:opacity-60"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {t("actions.complete")}
                </button>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

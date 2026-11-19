"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Download, Pencil, ShoppingCart } from "lucide-react";
import {
  APPOINTMENT_TRANSITIONS,
  formatMoney,
  type Appointment,
  type AppointmentStatus,
} from "@keystonehr/shared";
import { Link } from "@/i18n/navigation";
import { usePermissions } from "@/lib/permissions";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { TimelineRow } from "@/components/ui/timeline";
import {
  useAppointmentAction,
  type AppointmentAction,
} from "@/lib/queries/appointments";
import { downloadInvoicePdf } from "@/lib/queries/pos";
import { ACTION_BY_STATUS, STATUS_ICON, STATUS_ICON_CLASS, statusVariant } from "./appointment-card";

/** Appointment statuses that still allow editing barber/services/schedule. */
const EDITABLE_STATUSES: AppointmentStatus[] = ["waiting", "confirmed"];

/**
 * Read-only profile for a single appointment, reused by the appointments
 * drawer's "view" mode (mirrors Walk-in Queue's `WalkInDetailView`): customer/
 * barber/services/total/notes/history, the existing status-transition
 * buttons, and an Edit entry point while the appointment is still editable.
 */
export function AppointmentDetailView({ appointment, onEdit }: { appointment: Appointment; onEdit: () => void }) {
  const t = useTranslations("appointments.detail");
  const ts = useTranslations("appointments");
  const tc = useTranslations("common");
  const locale = useLocale();
  const action = useAppointmentAction();
  const permissions = usePermissions();
  const [actionError, setActionError] = useState<string | null>(null);

  const dateTimeFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  async function run(id: string, act: AppointmentAction) {
    setActionError(null);
    try {
      await action.mutateAsync({ id, action: act });
    } catch {
      // INVALID_STATUS_TRANSITION or anything else → single, safe message
      setActionError(t("actionFailed"));
    }
  }

  const nextStatuses = APPOINTMENT_TRANSITIONS[appointment.status];
  const editable = EDITABLE_STATUSES.includes(appointment.status);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Badge variant={statusVariant(appointment.status)}>{ts(`status.${appointment.status}`)}</Badge>
          <span dir="ltr" className="text-sm text-muted-foreground">
            {dateTimeFmt.format(new Date(appointment.scheduledStart))}
          </span>
        </div>
        {editable && permissions.includes("appointments.update") ? (
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
          <dt className="text-xs text-muted-foreground">{t("customer")}</dt>
          <dd className="mt-0.5">
            {appointment.customer ? (
              <>
                <span className="font-medium">{appointment.customer.name}</span>{" "}
                <span dir="ltr" className="text-muted-foreground">
                  {appointment.customer.mobile}
                </span>
              </>
            ) : appointment.customerName ? (
              <span className="font-medium">{appointment.customerName}</span>
            ) : (
              <span className="text-muted-foreground">{t("walkIn")}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("barber")}</dt>
          <dd className="mt-0.5 font-medium">{appointment.barber.name}</dd>
        </div>
      </dl>

      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{t("services")}</div>
        <ul className="space-y-1.5">
          {appointment.services.map((s) => (
            <li key={s.serviceId} className="flex items-center justify-between gap-3">
              <span>{locale === "ar" ? s.nameAr : s.nameEn}</span>
              <span className="whitespace-nowrap text-muted-foreground">
                {formatMoney(s.priceMinor, appointment.currency, locale)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2 font-semibold">
          <span>{t("total")}</span>
          <span>{formatMoney(appointment.totalMinor, appointment.currency, locale)}</span>
        </div>
      </div>

      {appointment.notes ? (
        <div className="text-sm">
          <div className="text-xs text-muted-foreground">{t("notes")}</div>
          <p className="mt-0.5">{appointment.notes}</p>
        </div>
      ) : null}

      {appointment.history && appointment.history.length > 0 ? (
        <div className="text-sm">
          <div className="mb-3 text-xs text-muted-foreground">{t("history")}</div>
          <div>
            {appointment.history.map((h, i) => (
              <TimelineRow
                key={i}
                icon={STATUS_ICON[h.toStatus]}
                iconClassName={STATUS_ICON_CLASS[h.toStatus]}
                label={
                  h.fromStatus === null
                    ? t("historyBooked")
                    : t("historyChangedTo", { status: ts(`status.${h.toStatus}`) })
                }
                timestamp={<span dir="ltr">{dateTimeFmt.format(new Date(h.at))}</span>}
                isLast={i === appointment.history!.length - 1}
              />
            ))}
          </div>
        </div>
      ) : null}

      {actionError ? <Alert>{actionError}</Alert> : null}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {nextStatuses.map((status) => {
          const spec = ACTION_BY_STATUS[status as Exclude<AppointmentStatus, "waiting">];
          if (!spec || !permissions.includes(spec.permission)) return null;
          const Icon = spec.icon;
          return (
            <button
              key={status}
              type="button"
              disabled={action.isPending}
              onClick={() => run(appointment.id, spec.action)}
              className={spec.className}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t(`actions.${spec.action}`)}
            </button>
          );
        })}
        {appointment.status === "completed" && !appointment.invoiceId && permissions.includes("pos.use") ? (
          <Link
            href={`/pos?appointmentId=${appointment.id}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-tint-warning-border bg-tint-warning-bg px-3.5 text-sm font-medium text-warning transition hover:brightness-110"
          >
            <ShoppingCart className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t("actions.checkout")}
          </Link>
        ) : null}
        {appointment.invoiceId && permissions.includes("invoices.view") ? (
          <button
            type="button"
            onClick={() => downloadInvoicePdf(appointment.invoiceId!, locale, appointment.appointmentNo)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3.5 text-sm font-medium transition hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t("actions.downloadInvoice")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

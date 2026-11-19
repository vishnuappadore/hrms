"use client";

import { useLocale, useTranslations } from "next-intl";
import { CalendarCheck, Check, Clock, Play, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Appointment, AppointmentStatus } from "@keystonehr/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { AppointmentAction } from "@/lib/queries/appointments";

export function statusVariant(status: AppointmentStatus): "success" | "muted" | "destructive" {
  if (status === "cancelled") return "destructive";
  if (status === "completed" || status === "in_progress") return "success";
  return "muted";
}

/** Small colour-coded dot per status — Month view's per-day mini-list has no room for a full Badge pill. */
export const STATUS_DOT: Record<AppointmentStatus, string> = {
  waiting: "bg-muted-foreground",
  confirmed: "bg-primary",
  in_progress: "bg-primary",
  completed: "bg-positive",
  cancelled: "bg-destructive",
};

/** History timeline icon/color per status — shared by Appointments' own detail-view history
 *  (a status-change trail) and Customer Details' visit-history list (a chronological list of past
 *  appointments), so both connected-dot timelines render identically. */
export const STATUS_ICON: Record<AppointmentStatus, LucideIcon> = {
  waiting: Clock,
  confirmed: CalendarCheck,
  in_progress: Play,
  completed: Check,
  cancelled: X,
};
export const STATUS_ICON_CLASS: Record<AppointmentStatus, string> = {
  waiting: "text-muted-foreground",
  confirmed: "text-primary",
  in_progress: "text-info",
  completed: "text-positive",
  cancelled: "text-destructive",
};

const ACTION_BTN_BASE =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3.5 text-sm font-medium transition disabled:opacity-60";

/**
 * Maps a target status to its action route, required permission, icon, and
 * outlined/tinted button style (mirrors Walk-in Queue) — shared by the
 * appointment detail view's action buttons and the Kanban board's
 * drag-and-drop drop-target validation, so both enforce the exact same rules.
 */
export const ACTION_BY_STATUS: Record<
  Exclude<AppointmentStatus, "waiting">,
  { action: AppointmentAction; permission: string; icon: LucideIcon; className: string } | undefined
> = {
  confirmed: {
    action: "confirm",
    permission: "appointments.update",
    icon: CalendarCheck,
    className: cn(ACTION_BTN_BASE, "border-border hover:bg-muted"),
  },
  in_progress: {
    action: "start",
    permission: "appointments.checkin",
    icon: Play,
    className: cn(ACTION_BTN_BASE, "border-tint-info-border bg-tint-info-bg text-info hover:brightness-110"),
  },
  completed: {
    action: "complete",
    permission: "appointments.checkin",
    icon: Check,
    className: cn(ACTION_BTN_BASE, "border-tint-positive-border bg-tint-positive-bg text-positive hover:brightness-110"),
  },
  cancelled: {
    action: "cancel",
    permission: "appointments.cancel",
    icon: X,
    className: cn(
      ACTION_BTN_BASE,
      "border-tint-destructive-border bg-tint-destructive-bg text-destructive hover:brightness-110",
    ),
  },
};

/** Compact appointment card shared by the Calendar and Kanban views. */
export function AppointmentCard({
  appointment,
  onOpen,
}: {
  appointment: Appointment;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("appointments");
  const locale = useLocale();
  const timeFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const services = appointment.services
    .map((s) => (locale === "ar" ? s.nameAr : s.nameEn))
    .join(locale === "ar" ? "، " : ", ");

  return (
    <button
      type="button"
      onClick={() => onOpen(appointment.id)}
      className="w-full rounded-lg border border-border bg-card p-2.5 text-start shadow-sm transition hover:border-primary/40 hover:bg-muted/40"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span dir="ltr" className="text-xs font-semibold text-foreground">
          {timeFmt.format(new Date(appointment.scheduledStart))}
        </span>
        <Badge variant={statusVariant(appointment.status)}>{t(`status.${appointment.status}`)}</Badge>
      </div>
      <div className="truncate text-sm font-medium text-foreground">
        {appointment.customer?.name ?? appointment.customerName ?? t("list.walkIn")}
      </div>
      {services ? (
        <div className="truncate text-xs text-muted-foreground">{services}</div>
      ) : null}
      <div className="truncate text-xs text-muted-foreground">{appointment.barber.name}</div>
    </button>
  );
}

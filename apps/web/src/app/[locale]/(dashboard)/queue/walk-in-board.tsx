"use client";

import { Check, Eye, Play, ShoppingCart, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AppointmentBarber } from "@keystonehr/shared";
import type { WalkIn } from "@keystonehr/shared";
import { Link } from "@/i18n/navigation";
import { IconActionButton } from "@/components/ui/icon-action-button";
import { Select } from "@/components/ui/select";
import { usePermissions } from "@/lib/permissions";
import { useAssignWalkInBarber, useWalkInAction } from "@/lib/queries/walk-ins";
import { WALKIN_BOARD_STATUSES, useServiceNames, useWaitLabel } from "./walk-in-queue";

interface BoardProps {
  entries: WalkIn[];
  barbers: AppointmentBarber[];
  isLoading: boolean;
  onView: (entry: WalkIn) => void;
}

export function WalkInBoard({ entries, barbers, isLoading, onView }: BoardProps) {
  const t = useTranslations("walkIn");
  const byStatus = (status: (typeof WALKIN_BOARD_STATUSES)[number]) =>
    entries.filter((e) => e.status === status);

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3" style={{ minWidth: `${WALKIN_BOARD_STATUSES.length * 16}rem` }}>
        {WALKIN_BOARD_STATUSES.map((status) => {
          const items = byStatus(status);
          return (
            <section
              key={status}
              className="flex max-h-[70vh] min-w-0 flex-1 flex-col rounded-xl border border-border bg-muted/30"
            >
              <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <span className="text-sm font-medium">{t(`status.${status}`)}</span>
                <span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {isLoading ? "…" : items.length}
                </span>
              </header>
              <div className="flex flex-col gap-2 overflow-y-auto p-2">
                {isLoading ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />
                  ))
                ) : items.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs text-muted-foreground">{t("board.empty")}</p>
                ) : (
                  items.map((e) => <WalkInCard key={e.id} entry={e} barbers={barbers} onView={onView} />)
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function WalkInCard({
  entry,
  barbers,
  onView,
}: {
  entry: WalkIn;
  barbers: AppointmentBarber[];
  onView: (entry: WalkIn) => void;
}) {
  const t = useTranslations("walkIn");
  const permissions = usePermissions();
  const serviceNames = useServiceNames(entry.services);
  const waitLabel = useWaitLabel(entry.queuedAt);
  const assignBarber = useAssignWalkInBarber();
  const action = useWalkInAction();

  const displayName = entry.customer?.name ?? entry.customerName ?? t("list.guest");

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{displayName}</div>
          <div className="truncate text-xs text-muted-foreground">{serviceNames}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {entry.status !== "completed" ? (
            <span className="whitespace-nowrap text-xs text-muted-foreground">{waitLabel}</span>
          ) : null}
          <IconActionButton
            variant="neutral"
            label={t("actions.view")}
            onClick={() => onView(entry)}
            className="h-7 w-7"
          >
            <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
          </IconActionButton>
        </div>
      </div>

      {entry.status !== "completed" && permissions.includes("walkin.update") ? (
        <Select
          aria-label={t("list.barber")}
          value={entry.barberStaffId ?? ""}
          onChange={(e) =>
            assignBarber.mutate({ id: entry.id, input: { barberStaffId: e.target.value || null } })
          }
          className="mb-2"
        >
          <option value="">{t("list.unassigned")}</option>
          {barbers.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      ) : entry.status !== "completed" ? (
        <p className="mb-2 text-xs text-muted-foreground">
          {entry.barber?.name ?? t("list.unassigned")}
        </p>
      ) : null}

      {entry.status === "waiting" ? (
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      ) : entry.status === "serving" ? (
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      ) : null}
    </div>
  );
}

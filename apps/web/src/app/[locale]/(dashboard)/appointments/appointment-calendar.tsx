"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Appointment, AppointmentBarber, AppointmentStatus, Branch } from "@keystonehr/shared";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { useAppointmentBarbers, useAppointments } from "@/lib/queries/appointments";
import { AppointmentCard, STATUS_DOT, statusVariant } from "./appointment-card";

/** Minutes-of-day helpers for the Day view's barber × time-slot grid. */
const SLOT_MINUTES = 30;
function toMinutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}
function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

/**
 * Classic calendar "columns" overlap layout (same algorithm as Google
 * Calendar's day view), scoped to one barber's appointments for the day:
 * walks them in start-time order, greedily reusing the first column whose
 * last-placed appointment has already ended, opening a new column otherwise.
 * Every appointment in a connected overlap cluster shares that cluster's
 * `columnCount`; non-overlapping appointments naturally get `columnCount: 1`
 * (full-width, unchanged from before this existed). Status (incl. cancelled)
 * is irrelevant here — overlap is purely about time ranges.
 */
function layoutOverlapColumns(
  appointments: Appointment[],
): Map<string, { columnIndex: number; columnCount: number }> {
  const sorted = [...appointments].sort(
    (a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime(),
  );
  const result = new Map<string, { columnIndex: number; columnCount: number }>();
  let columnEnds: number[] = [];
  let cluster: string[] = [];
  let clusterEnd = -Infinity;

  const finalizeCluster = () => {
    for (const id of cluster) result.get(id)!.columnCount = columnEnds.length;
    columnEnds = [];
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const a of sorted) {
    const start = new Date(a.scheduledStart).getTime();
    const end = new Date(a.scheduledEnd).getTime();
    if (cluster.length > 0 && start >= clusterEnd) finalizeCluster();

    let columnIndex = columnEnds.findIndex((e) => e <= start);
    if (columnIndex === -1) {
      columnIndex = columnEnds.length;
      columnEnds.push(end);
    } else {
      columnEnds[columnIndex] = end;
    }
    result.set(a.id, { columnIndex, columnCount: 1 });
    cluster.push(a.id);
    clusterEnd = Math.max(clusterEnd, end);
  }
  finalizeCluster();
  return result;
}

export type CalendarMode = "day" | "week" | "month";
export const CALENDAR_MODES: CalendarMode[] = ["day", "week", "month"];

/* ── date helpers (local time; no external lib) ───────────────────────────── */
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
/** `weekStartsOn`: 0 (Sunday) … 6 (Saturday) — the tenant's General Settings
 *  preference (`packages/shared/src/schemas/branch.ts`'s WEEKDAYS), defaults
 *  to Sunday (GCC work week Sun–Thu) to match the prior hardcoded behavior. */
export function startOfWeek(d: Date, weekStartsOn = 0): Date {
  const s = startOfDay(d);
  const diff = (s.getDay() - weekStartsOn + 7) % 7;
  return addDays(s, -diff);
}
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

interface CalendarProps {
  branchId: string | undefined;
  branch: Branch | undefined;
  search?: string;
  status?: AppointmentStatus;
  mode: CalendarMode;
  cursor: Date;
  /** 0 (Sunday) … 6 (Saturday) — tenant's General Settings week-start preference. */
  weekStartsOn?: number;
  onModeChange: (mode: CalendarMode) => void;
  onCursorChange: (cursor: Date) => void;
  onOpen: (id: string) => void;
}

export function AppointmentCalendar({
  branchId,
  branch,
  search,
  status,
  mode,
  cursor,
  weekStartsOn = 0,
  onModeChange,
  onCursorChange,
  onOpen,
}: CalendarProps) {
  const t = useTranslations("appointments");
  const tc = useTranslations("common");
  const locale = useLocale();
  const intl = locale === "ar" ? "ar" : "en";

  // visible window for the current mode → drives the fetch range + layout
  const { from, to } = useMemo(() => {
    if (mode === "day") return { from: startOfDay(cursor), to: addDays(startOfDay(cursor), 1) };
    if (mode === "week") {
      const s = startOfWeek(cursor, weekStartsOn);
      return { from: s, to: addDays(s, 7) };
    }
    const gridStart = startOfWeek(startOfMonth(cursor), weekStartsOn);
    return { from: gridStart, to: addDays(gridStart, 42) };
  }, [mode, cursor, weekStartsOn]);

  const { data, isLoading, isError } = useAppointments({
    branchId,
    search,
    status,
    from: from.toISOString(),
    to: new Date(to.getTime() - 1).toISOString(),
    pageSize: 100,
  });
  const appts = data?.data ?? [];
  const barbersQuery = useAppointmentBarbers(mode === "day" ? branch?.id : undefined);
  const barbers = barbersQuery.data ?? [];
  const onDay = (d: Date) =>
    appts
      .filter((a) => sameDay(new Date(a.scheduledStart), d))
      .sort(
        (a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime(),
      );

  return (
    <div className="space-y-3">
      {isError ? (
        <Alert>{tc("loadFailed")}</Alert>
      ) : mode === "day" ? (
        <DayView
          items={onDay(cursor)}
          barbers={barbers}
          workingHours={branch?.workingHours}
          isLoading={isLoading}
          barbersLoading={barbersQuery.isLoading}
          onOpen={onOpen}
        />
      ) : mode === "week" ? (
        <WeekView
          start={startOfWeek(cursor, weekStartsOn)}
          onDay={onDay}
          isLoading={isLoading}
          onOpen={onOpen}
          intl={intl}
        />
      ) : (
        <MonthView
          cursor={cursor}
          gridStart={from}
          onDay={onDay}
          isLoading={isLoading}
          intl={intl}
          moreLabel={(n) => t("calendar.more", { count: n })}
          onPickDay={(d) => {
            onCursorChange(d);
            onModeChange("day");
          }}
        />
      )}
    </div>
  );
}

/** Day view: barber columns (X) × fixed time-slot rows (Y), derived from the branch's working hours. */
function DayView({
  items,
  barbers,
  workingHours,
  isLoading,
  barbersLoading,
  onOpen,
}: {
  items: Appointment[];
  barbers: AppointmentBarber[];
  workingHours: Branch["workingHours"] | undefined;
  isLoading: boolean;
  barbersLoading: boolean;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("appointments");
  const locale = useLocale();

  const slots = useMemo(() => {
    if (!workingHours) return [];
    const open = parseHHMM(workingHours.openingTime);
    const close = parseHHMM(workingHours.closingTime);
    const result: { minutes: number; label: string }[] = [];
    for (let m = open; m < close; m += SLOT_MINUTES) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      result.push({ minutes: m, label: `${hh}:${mm}` });
    }
    return result;
  }, [workingHours]);

  const overlapLayout = useMemo(() => {
    const byBarber = new Map<string, Appointment[]>();
    for (const a of items) {
      const list = byBarber.get(a.barberId);
      if (list) list.push(a);
      else byBarber.set(a.barberId, [a]);
    }
    const merged = new Map<string, { columnIndex: number; columnCount: number }>();
    for (const list of byBarber.values()) {
      for (const [id, layout] of layoutOverlapColumns(list)) merged.set(id, layout);
    }
    return merged;
  }, [items]);

  if (isLoading || barbersLoading) {
    return (
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }
  if (slots.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card px-4 py-16 text-center text-sm text-muted-foreground">
        {t("calendar.noWorkingHours")}
      </div>
    );
  }
  if (barbers.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card px-4 py-16 text-center text-sm text-muted-foreground">
        {t("calendar.noBarbers")}
      </div>
    );
  }

  const headerCells = [
    <div
      key="corner"
      className="sticky top-0 start-0 z-20 border-b border-e border-border bg-card"
      style={{ gridColumn: 1, gridRow: 1 }}
    />,
    ...barbers.map((b, i) => (
      <div
        key={b.id}
        className="sticky top-0 z-10 flex min-w-0 items-center gap-2 border-b border-e border-border bg-card px-2 py-2"
        style={{ gridColumn: i + 2, gridRow: 1 }}
      >
        <Avatar name={b.name} className="h-8 w-8 shrink-0 rounded-full text-xs" />
        <span className="truncate text-sm font-medium">{b.name}</span>
      </div>
    )),
  ];

  const slotCells = slots.flatMap((slot, r) => [
    <div
      key={`time-${slot.minutes}`}
      className="sticky start-0 z-10 border-b border-e border-border bg-card px-2 py-1 text-end text-[11px] text-muted-foreground"
      style={{ gridColumn: 1, gridRow: r + 2 }}
    >
      {slot.label}
    </div>,
    ...barbers.map((_, c) => (
      <div
        key={`cell-${slot.minutes}-${c}`}
        className="border-b border-e border-border"
        style={{ gridColumn: c + 2, gridRow: r + 2 }}
      />
    )),
  ]);

  const cardCells = items.flatMap((a) => {
    const barberIndex = barbers.findIndex((b) => b.id === a.barberId);
    if (barberIndex === -1) return [];
    const startMinutes = toMinutesOfDay(new Date(a.scheduledStart));
    const rawIndex = Math.floor((startMinutes - slots[0]!.minutes) / SLOT_MINUTES);
    const slotIndex = Math.max(0, Math.min(slots.length - 1, rawIndex));
    const rawSpan = Math.max(1, Math.round(a.durationMinutes / SLOT_MINUTES));
    const rowSpan = Math.min(rawSpan, slots.length - slotIndex);
    const { columnIndex, columnCount } = overlapLayout.get(a.id) ?? { columnIndex: 0, columnCount: 1 };
    const services = a.services
      .map((s) => (locale === "ar" ? s.nameAr : s.nameEn))
      .join(locale === "ar" ? "، " : ", ");
    return [
      <button
        key={a.id}
        type="button"
        onClick={() => onOpen(a.id)}
        className="relative z-[1] m-0.5 overflow-hidden rounded-lg border border-border bg-card p-1.5 text-start shadow-sm transition hover:border-primary/40 hover:bg-muted/40"
        style={{
          gridColumn: barberIndex + 2,
          gridRow: `${slotIndex + 2} / span ${rowSpan}`,
          width: `${100 / columnCount}%`,
          marginInlineStart: `${(100 / columnCount) * columnIndex}%`,
        }}
      >
        <div className="flex items-center justify-between gap-1.5">
          <span className="min-w-0 flex-1 truncate text-xs font-semibold">
            {a.customer?.name ?? t("list.walkIn")}
          </span>
          <Badge variant={statusVariant(a.status)}>{t(`status.${a.status}`)}</Badge>
        </div>
        {services ? <div className="truncate text-[11px] text-muted-foreground">{services}</div> : null}
      </button>,
    ];
  });

  return (
    <div className="overflow-auto rounded-xl border border-border" style={{ maxHeight: "70vh" }}>
      <div
        className="grid"
        style={{
          gridTemplateColumns: `4rem repeat(${barbers.length}, minmax(11rem, 1fr))`,
          gridTemplateRows: `auto repeat(${slots.length}, 3.5rem)`,
        }}
      >
        {headerCells}
        {slotCells}
        {cardCells}
      </div>
    </div>
  );
}

function WeekView({
  start,
  onDay,
  isLoading,
  onOpen,
  intl,
}: {
  start: Date;
  onDay: (d: Date) => Appointment[];
  isLoading: boolean;
  onOpen: (id: string) => void;
  intl: string;
}) {
  const today = startOfDay(new Date());
  const dayFmt = new Intl.DateTimeFormat(intl, { weekday: "short" });
  const numFmt = new Intl.DateTimeFormat(intl, { day: "numeric" });
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[52rem] grid-cols-7 gap-2">
        {days.map((d) => {
          const isToday = sameDay(d, today);
          const items = onDay(d);
          return (
            <div key={d.toISOString()} className="min-w-0 overflow-hidden rounded-xl border border-border bg-muted/20">
              <div
                className={cn(
                  "border-b border-border px-2 py-1.5 text-center",
                  isToday && "bg-primary-muted",
                )}
              >
                <div className="text-[11px] font-medium text-muted-foreground">{dayFmt.format(d)}</div>
                <div className={cn("text-sm font-semibold", isToday && "text-primary")}>
                  {numFmt.format(d)}
                </div>
              </div>
              <div className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto p-1.5">
                {isLoading ? (
                  <div className="h-16 animate-pulse rounded-lg bg-muted" />
                ) : (
                  items.map((a) => <AppointmentCard key={a.id} appointment={a} onOpen={onOpen} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthView({
  cursor,
  gridStart,
  onDay,
  isLoading,
  intl,
  moreLabel,
  onPickDay,
}: {
  cursor: Date;
  gridStart: Date;
  onDay: (d: Date) => Appointment[];
  isLoading: boolean;
  intl: string;
  moreLabel: (n: number) => string;
  onPickDay: (d: Date) => void;
}) {
  const today = startOfDay(new Date());
  const weekdayFmt = new Intl.DateTimeFormat(intl, { weekday: "short" });
  const headers = Array.from({ length: 7 }, (_, i) => addDays(gridStart, i));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const timeFmt = new Intl.DateTimeFormat(intl, { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[48rem] overflow-hidden rounded-xl border border-border">
        <div className="grid grid-cols-7 border-b border-border bg-muted/40">
          {headers.map((h) => (
            <div
              key={h.toISOString()}
              className="px-2 py-1.5 text-center text-[11px] font-medium text-muted-foreground"
            >
              {weekdayFmt.format(h)}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d) => {
            const inMonth = d.getMonth() === cursor.getMonth();
            const isToday = sameDay(d, today);
            const items = onDay(d);
            return (
              <button
                key={d.toISOString()}
                type="button"
                onClick={() => onPickDay(d)}
                className={cn(
                  "flex min-h-24 flex-col gap-1 border-b border-e border-border p-1.5 text-start align-top transition hover:bg-muted/40",
                  !inMonth && "bg-muted/20 text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "self-start text-xs font-medium",
                    isToday &&
                      "flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground",
                  )}
                >
                  {d.getDate()}
                </span>
                {isLoading ? (
                  inMonth ? <span className="h-3 w-10 animate-pulse rounded bg-muted" /> : null
                ) : (
                  <>
                    {items.slice(0, 3).map((a) => (
                      <span
                        key={a.id}
                        className="flex items-center gap-1 truncate text-[10.5px] text-foreground"
                      >
                        <span
                          aria-hidden="true"
                          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[a.status])}
                        />
                        <span dir="ltr">{timeFmt.format(new Date(a.scheduledStart))}</span>
                        <span className="truncate">{a.customer?.name ?? ""}</span>
                      </span>
                    ))}
                    {items.length > 3 ? (
                      <span className="text-[10.5px] text-muted-foreground">
                        {moreLabel(items.length - 3)}
                      </span>
                    ) : null}
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

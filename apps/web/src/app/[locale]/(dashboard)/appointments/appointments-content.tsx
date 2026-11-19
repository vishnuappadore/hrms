"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarDays, ChevronLeft, ChevronRight, Download, Eye, KanbanSquare, List as ListIcon } from "lucide-react";
import { APPOINTMENT_STATUSES, type Appointment, type AppointmentStatus } from "@keystonehr/shared";
import { DataTable } from "@/components/data-table";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { BoxedToggle } from "@/components/ui/boxed-toggle";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { IconActionButton } from "@/components/ui/icon-action-button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { usePermissions } from "@/lib/permissions";
import { useBranches } from "@/lib/queries/branches";
import { useAppointments } from "@/lib/queries/appointments";
import { useGeneralSettings } from "@/lib/queries/general-settings";
import { downloadInvoicePdf } from "@/lib/queries/pos";
import { AppointmentDrawer, type AppointmentDrawerState } from "./appointment-drawer";
import {
  AppointmentCalendar,
  CALENDAR_MODES,
  addDays,
  startOfDay,
  startOfWeek,
  type CalendarMode,
} from "./appointment-calendar";
import { AppointmentKanban } from "./appointment-kanban";
import { statusVariant } from "./appointment-card";

type ViewKey = "calendar" | "kanban" | "list";

const VIEWS: { key: ViewKey; icon: typeof ListIcon }[] = [
  { key: "calendar", icon: CalendarDays },
  { key: "kanban", icon: KanbanSquare },
  { key: "list", icon: ListIcon },
];

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Maps WEEKDAYS (packages/shared/src/schemas/branch.ts) to JS's `Date.getDay()` convention. */
const WEEKDAY_JS_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export function AppointmentsContent({
  initialCustomerId = null,
}: {
  initialCustomerId?: string | null;
}) {
  const t = useTranslations("appointments");
  const tc = useTranslations("common");
  const locale = useLocale();
  const permissions = usePermissions();
  const generalSettings = useGeneralSettings();
  const weekStartsOn = WEEKDAY_JS_INDEX[generalSettings.data?.weekStartsOn ?? "sunday"] ?? 0;

  const branchesQuery = useBranches({ status: "active", pageSize: 100 });
  const branches = branchesQuery.data?.data ?? [];
  const [branchId, setBranchId] = useState<string | undefined>();
  useEffect(() => {
    if (!branchId && branches.length > 0) setBranchId(branches[0]!.id);
  }, [branches, branchId]);
  const selectedBranch = branches.find((b) => b.id === branchId);

  const [view, setView] = useState<ViewKey>("list");
  // shared filters across all three views
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState<string | undefined>();
  const [status, setStatus] = useState<AppointmentStatus | undefined>();
  // list-only pagination/sort
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<string | undefined>();
  const [drawerState, setDrawerState] = useState<AppointmentDrawerState>(null);

  // "Book Appointment" from Customer Details (?newForCustomerId=), once branchId resolves — same
  // gate the "+ New Appointment" button itself waits on.
  const openedForCustomer = useRef(false);
  useEffect(() => {
    if (!initialCustomerId || openedForCustomer.current || !branchId) return;
    openedForCustomer.current = true;
    setDrawerState({ mode: "create", customerId: initialCustomerId });
  }, [initialCustomerId, branchId]);

  // calendar-only: mode (Day/Week/Month) + selected date, lifted here so both the
  // header toggle and the filter row's date nav can drive the same state
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("week");
  const [calendarCursor, setCalendarCursor] = useState<Date>(() => startOfDay(new Date()));

  // list/kanban-only: date range, defaulting to today
  const [dateFrom, setDateFrom] = useState(todayString());
  const [dateTo, setDateTo] = useState(todayString());
  function handleDateRangeChange(nextFrom: string, nextTo: string) {
    setDateFrom(nextFrom);
    setDateTo(nextTo < nextFrom ? nextFrom : nextTo);
    setPage(1);
  }
  const rangeFrom = `${dateFrom}T00:00:00`;
  const rangeTo = `${dateTo}T23:59:59.999`;

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch((prev) => {
        const next = searchInput || undefined;
        if (prev !== next) setPage(1);
        return next;
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // only the List view uses this query; gate it off for calendar/kanban
  const { data, isLoading, isError } = useAppointments({
    branchId: view === "list" ? branchId : undefined,
    search,
    status,
    from: rangeFrom,
    to: rangeTo,
    page,
    pageSize: 25,
    sort,
  });

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
    [locale],
  );
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", { hour: "2-digit", minute: "2-digit" }),
    [locale],
  );

  const calendarIntl = locale === "ar" ? "ar" : "en";
  const periodLabel = useMemo(() => {
    if (calendarMode === "day")
      return new Intl.DateTimeFormat(calendarIntl, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(calendarCursor);
    if (calendarMode === "week") {
      const s = startOfWeek(calendarCursor, weekStartsOn);
      const e = addDays(s, 6);
      const d = new Intl.DateTimeFormat(calendarIntl, { day: "numeric", month: "short" });
      return `${d.format(s)} – ${d.format(e)} ${e.getFullYear()}`;
    }
    return new Intl.DateTimeFormat(calendarIntl, { month: "long", year: "numeric" }).format(calendarCursor);
  }, [calendarMode, calendarCursor, calendarIntl, weekStartsOn]);

  function shiftCalendar(dir: -1 | 1) {
    if (calendarMode === "day") setCalendarCursor((c) => addDays(c, dir));
    else if (calendarMode === "week") setCalendarCursor((c) => addDays(c, dir * 7));
    else setCalendarCursor((c) => new Date(c.getFullYear(), c.getMonth() + dir, 1));
  }

  const columns = useMemo<ColumnDef<Appointment>[]>(
    () => [
      {
        id: "appointmentNo",
        header: t("list.number"),
        enableSorting: true,
        cell: ({ row }) => (
          <span dir="ltr" className="whitespace-nowrap font-medium">
            {row.original.appointmentNo}
          </span>
        ),
      },
      {
        id: "customer",
        header: t("list.customer"),
        cell: ({ row }) =>
          row.original.customer ? (
            <div className="leading-tight">
              <div className="font-medium">{row.original.customer.name}</div>
              <div dir="ltr" className="text-start text-xs text-muted-foreground">
                {row.original.customer.mobile}
              </div>
            </div>
          ) : row.original.customerName ? (
            <div className="font-medium">{row.original.customerName}</div>
          ) : (
            <span className="text-muted-foreground">{t("list.walkIn")}</span>
          ),
      },
      {
        id: "services",
        header: t("list.services"),
        cell: ({ row }) => {
          const names = row.original.services.map((s) => (locale === "ar" ? s.nameAr : s.nameEn));
          if (names.length === 0) return "—";
          return (
            <span className="whitespace-nowrap">
              {names[0]}
              {names.length > 1 ? ` +${names.length - 1}` : ""}
            </span>
          );
        },
      },
      {
        id: "barber",
        header: t("list.barber"),
        cell: ({ row }) => row.original.barber.name,
      },
      {
        id: "date",
        header: t("list.date"),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{dateFmt.format(new Date(row.original.scheduledStart))}</span>
        ),
      },
      {
        id: "time",
        header: t("list.time"),
        cell: ({ row }) => (
          <span dir="ltr" className="whitespace-nowrap text-start">
            {timeFmt.format(new Date(row.original.scheduledStart))}
          </span>
        ),
      },
      {
        id: "status",
        header: t("list.status"),
        cell: ({ row }) => (
          <Badge variant={statusVariant(row.original.status)}>{t(`status.${row.original.status}`)}</Badge>
        ),
      },
      {
        id: "actions",
        header: tc("actions"),
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <IconActionButton
              variant="neutral"
              label={t("list.view")}
              onClick={() => setDrawerState({ mode: "view", appointmentId: row.original.id })}
            >
              <Eye className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            </IconActionButton>
            {row.original.invoiceId && permissions.includes("invoices.view") ? (
              <IconActionButton
                variant="neutral"
                label={t("list.downloadInvoice")}
                onClick={() =>
                  downloadInvoicePdf(row.original.invoiceId!, locale, row.original.appointmentNo)
                }
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
              </IconActionButton>
            ) : null}
          </div>
        ),
      },
    ],
    [t, tc, locale, dateFmt, timeFmt, permissions],
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <BoxedToggle<ViewKey>
            value={view}
            onChange={setView}
            aria-label={t("views.label")}
            options={VIEWS.map(({ key, icon }) => ({ value: key, label: t(`views.${key}`), icon }))}
          />
          {view === "calendar" ? (
            <BoxedToggle<CalendarMode>
              value={calendarMode}
              onChange={setCalendarMode}
              aria-label={t("calendar.mode")}
              options={CALENDAR_MODES.map((m) => ({ value: m, label: t(`calendar.${m}`) }))}
            />
          ) : null}
          {permissions.includes("appointments.create") && (
            <Button onClick={() => setDrawerState({ mode: "create" })} disabled={!branchId}>
              + {t("newAppointment")}
            </Button>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-nowrap items-center justify-between gap-3 overflow-x-auto pb-1">
        <div className="flex shrink-0 flex-nowrap items-center gap-3">
          <Select
            value={branchId ?? ""}
            onChange={(e) => {
              setBranchId(e.target.value || undefined);
              setPage(1);
            }}
            className="w-56 shrink-0"
            aria-label={t("branch")}
          >
            {branches.length === 0 ? (
              <option value="">{t("noBranches")}</option>
            ) : (
              branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {locale === "ar" ? b.nameAr : b.nameEn}
                </option>
              ))
            )}
          </Select>
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-64 shrink-0"
          />
          {/* Kanban columns already segment by status, so the status filter is hidden there */}
          {view !== "kanban" ? (
            <Select
              value={status ?? ""}
              onChange={(e) => {
                setStatus((e.target.value || undefined) as AppointmentStatus | undefined);
                setPage(1);
              }}
              className="w-44 shrink-0"
              aria-label={t("list.status")}
            >
              <option value="">{t("filters.allStatuses")}</option>
              {APPOINTMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
          ) : null}
        </div>

        {view === "calendar" ? (
          <div className="flex shrink-0 items-center gap-2">
            <span className="min-w-40 text-end text-sm font-medium tabular-nums">{periodLabel}</span>
            <div className="flex items-center gap-1">
              <IconButton label={t("calendar.previous")} onClick={() => shiftCalendar(-1)}>
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.75} aria-hidden="true" />
              </IconButton>
              <button
                type="button"
                onClick={() => setCalendarCursor(startOfDay(new Date()))}
                className="h-8 rounded-lg border border-input bg-card px-3 text-xs font-medium shadow-sm transition hover:bg-muted"
              >
                {t("calendar.today")}
              </button>
              <IconButton label={t("calendar.next")} onClick={() => shiftCalendar(1)}>
                <ChevronRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.75} aria-hidden="true" />
              </IconButton>
            </div>
          </div>
        ) : (
          <DateRangePicker
            from={dateFrom}
            to={dateTo}
            onChange={handleDateRangeChange}
            fromLabel={t("filters.dateFrom")}
            toLabel={t("filters.dateTo")}
            className="shrink-0"
          />
        )}
      </div>

      {view === "calendar" ? (
        <AppointmentCalendar
          branchId={branchId}
          branch={selectedBranch}
          search={search}
          status={status}
          mode={calendarMode}
          cursor={calendarCursor}
          weekStartsOn={weekStartsOn}
          onModeChange={setCalendarMode}
          onCursorChange={setCalendarCursor}
          onOpen={(appointmentId) => setDrawerState({ mode: "view", appointmentId })}
        />
      ) : view === "kanban" ? (
        <AppointmentKanban
          branchId={branchId}
          search={search}
          from={rangeFrom}
          to={rangeTo}
          onOpen={(appointmentId) => setDrawerState({ mode: "view", appointmentId })}
        />
      ) : isError ? (
        <Alert>{tc("loadFailed")}</Alert>
      ) : (
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          meta={data?.meta}
          isLoading={isLoading}
          sort={sort}
          onSortChange={(s) => {
            setSort(s);
            setPage(1);
          }}
          onPageChange={setPage}
        />
      )}

      <AppointmentDrawer
        state={drawerState}
        branch={selectedBranch}
        onClose={() => setDrawerState(null)}
        onEdit={(appointmentId) => setDrawerState({ mode: "edit", appointmentId })}
      />
    </div>
  );
}

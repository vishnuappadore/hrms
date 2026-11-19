"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarDays, CalendarOff, Clock, Percent, UserCheck, UserX } from "lucide-react";
import type { AttendanceDaySummary, AttendanceMonthlyAggregate, AttendanceScope } from "@keystonehr/shared";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { BoxedToggle } from "@/components/ui/boxed-toggle";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { KpiCard } from "@/components/kpi-card";
import { DataTable } from "@/components/data-table";
import { useBranches } from "@/lib/queries/branches";
import { useAttendanceKpis, useAttendanceList } from "@/lib/queries/attendance";
import { formatTime } from "./attendance-time";
import { AttendanceSessionDialog } from "./attendance-session-dialog";
import { AttendanceMonthlyDetailDialog } from "./attendance-monthly-detail-dialog";
import { STATUS_BADGE_VARIANT } from "./attendance-status";

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentMonthString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function toDdMmYyyy(isoDate: string): string {
  return `${isoDate.slice(8, 10)}-${isoDate.slice(5, 7)}-${isoDate.slice(0, 4)}`;
}

function monthYearLabel(month: string, locale: string): string {
  return new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function AttendanceContent() {
  const t = useTranslations("attendance");
  const tc = useTranslations("common");
  const locale = useLocale();

  const { data: branchesData } = useBranches({ page: 1, pageSize: 100, status: "active" });
  const branches = branchesData?.data ?? [];

  const [scope, setScope] = useState<AttendanceScope>("today");
  const [date, setDate] = useState(todayString());
  const [month, setMonth] = useState(currentMonthString());
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [sessionTarget, setSessionTarget] = useState<{ staffProfileId: string; date: string } | null>(
    null,
  );
  const [monthlyTarget, setMonthlyTarget] = useState<{ staffProfileId: string; name: string } | null>(
    null,
  );

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput || undefined), 400);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [scope, date, month, branchId, search]);

  const commonParams = {
    scope,
    date: scope === "today" ? date : undefined,
    month: scope === "monthly" ? month : undefined,
    branchId,
    search,
  };
  const { data, isLoading } = useAttendanceList({ ...commonParams, page, pageSize: 25 });
  const kpis = useAttendanceKpis(commonParams);

  const todayColumns = useMemo<ColumnDef<AttendanceDaySummary>[]>(
    () => [
      {
        id: "staff",
        header: t("table.staff"),
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <Avatar name={row.original.staff.name} />
            <div className="min-w-0">
              <p className="truncate font-medium">{row.original.staff.name}</p>
              {row.original.staff.branchName && (
                <p className="truncate text-xs text-muted-foreground">{row.original.staff.branchName}</p>
              )}
            </div>
          </div>
        ),
      },
      {
        id: "status",
        header: t("table.status"),
        cell: ({ row }) => (
          <Badge variant={STATUS_BADGE_VARIANT[row.original.status]}>
            {t(`status.${row.original.status}`)}
          </Badge>
        ),
      },
      {
        id: "checkIn",
        header: t("table.checkIn"),
        cell: ({ row }) => formatTime(row.original.firstInAt, locale),
      },
      {
        id: "checkOut",
        header: t("table.checkOut"),
        cell: ({ row }) => formatTime(row.original.lastOutAt, locale),
      },
      {
        id: "hours",
        header: t("table.hours"),
        cell: ({ row }) => formatHours(row.original.totalWorkedMinutes),
      },
      {
        id: "sessions",
        header: "",
        cell: ({ row }) => (
          <IconButton
            className="relative"
            label={t("table.viewLog")}
            onClick={() =>
              setSessionTarget({
                staffProfileId: row.original.staff.id,
                date: row.original.date.toString().slice(0, 10),
              })
            }
          >
            <Clock className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            {row.original.sessionCount > 1 && (
              <span className="absolute -top-1.5 -end-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                ×{row.original.sessionCount}
              </span>
            )}
          </IconButton>
        ),
      },
    ],
    [t, locale],
  );

  const monthlyColumns = useMemo<ColumnDef<AttendanceMonthlyAggregate>[]>(
    () => [
      {
        id: "staff",
        header: t("table.staff"),
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <Avatar name={row.original.staff.name} />
            <div className="min-w-0">
              <p className="truncate font-medium">{row.original.staff.name}</p>
              {row.original.staff.branchName && (
                <p className="truncate text-xs text-muted-foreground">{row.original.staff.branchName}</p>
              )}
            </div>
          </div>
        ),
      },
      { id: "present", header: t("table.present"), cell: ({ row }) => row.original.presentDays },
      { id: "late", header: t("table.late"), cell: ({ row }) => row.original.lateDays },
      { id: "leave", header: t("table.leave"), cell: ({ row }) => row.original.leaveDays },
      { id: "absentCol", header: t("table.absent"), cell: ({ row }) => row.original.absentDays },
      {
        id: "totalHours",
        header: t("table.totalHours"),
        cell: ({ row }) => formatHours(row.original.totalWorkedMinutes),
      },
      {
        id: "rate",
        header: t("table.rate"),
        cell: ({ row }) => `${row.original.attendanceRatePct}%`,
      },
      {
        id: "detail",
        header: "",
        cell: ({ row }) => (
          <IconButton
            label={t("table.viewMonthly")}
            onClick={() => setMonthlyTarget({ staffProfileId: row.original.staff.id, name: row.original.staff.name })}
          >
            <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        ),
      },
    ],
    [t],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">
            {scope === "today"
              ? t("subtitleToday", { date: toDdMmYyyy(date) })
              : t("subtitleMonthly", { month: monthYearLabel(month, locale) })}
          </p>
        </div>
        <BoxedToggle
          aria-label={t("scopeLabel")}
          value={scope}
          onChange={setScope}
          options={[
            { value: "today", label: t("scopeToday"), icon: Clock },
            { value: "monthly", label: t("scopeMonthly"), icon: CalendarDays },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={tc("search")}
          className="min-w-0 max-w-56 flex-1"
        />
        <Select
          value={branchId ?? ""}
          onChange={(e) => setBranchId(e.target.value || undefined)}
          className="min-w-0 max-w-48"
        >
          <option value="">{t("allBranches")}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nameEn}
            </option>
          ))}
        </Select>
        {scope === "today" ? (
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label={t("table.checkIn")}
            className="min-w-0 max-w-44"
          />
        ) : (
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label={t("scopeMonthly")}
            className="min-w-0 max-w-44"
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label={scope === "today" ? t("kpis.presentToday") : t("kpis.presentDays")}
          value={kpis.data?.present}
          icon={UserCheck}
          loading={kpis.isLoading}
        />
        <KpiCard
          label={scope === "today" ? t("kpis.late") : t("kpis.lateArrivals")}
          value={kpis.data?.late}
          icon={Clock}
          loading={kpis.isLoading}
        />
        <KpiCard
          label={scope === "today" ? t("kpis.onLeave") : t("kpis.leaveDays")}
          value={kpis.data?.onLeave}
          icon={CalendarOff}
          loading={kpis.isLoading}
        />
        <KpiCard
          label={scope === "today" ? t("kpis.absent") : t("kpis.absentDays")}
          value={kpis.data?.absent}
          icon={UserX}
          loading={kpis.isLoading}
        />
        <KpiCard
          label={t("kpis.rate")}
          value={kpis.data ? `${kpis.data.attendanceRatePct}%` : undefined}
          icon={Percent}
          loading={kpis.isLoading}
        />
      </div>

      {scope === "today" ? (
        <DataTable
          columns={todayColumns}
          data={(data?.data as AttendanceDaySummary[]) ?? []}
          meta={data?.meta}
          isLoading={isLoading}
          onPageChange={setPage}
        />
      ) : (
        <DataTable
          columns={monthlyColumns}
          data={(data?.data as AttendanceMonthlyAggregate[]) ?? []}
          meta={data?.meta}
          isLoading={isLoading}
          onPageChange={setPage}
        />
      )}

      <AttendanceSessionDialog target={sessionTarget} onClose={() => setSessionTarget(null)} />
      <AttendanceMonthlyDetailDialog
        target={monthlyTarget}
        month={month}
        onClose={() => setMonthlyTarget(null)}
        onOpenDay={(staffProfileId, dateStr) => setSessionTarget({ staffProfileId, date: dateStr })}
      />
    </div>
  );
}

function formatHours(minutes: number): string {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

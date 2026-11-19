import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Prisma } from "@prisma/client";
import {
  ATTENDANCE_LATE_GRACE_MINUTES,
  ERROR_CODES,
  payrollMonthBounds,
  type AttendanceDayDetail,
  type AttendanceDaySummary,
  type AttendanceDayStatus,
  type AttendanceKpis,
  type AttendanceKpisQuery,
  type AttendanceMonthlyAggregate,
  type AttendanceMonthlyDayRow,
  type AttendanceMonthlyDetail,
  type AttendanceSession as AttendanceSessionResponse,
  type ListAttendanceQuery,
  type MyAttendanceToday,
  type Paginated,
  type UpdateAttendanceDayInput,
} from "@keystonehr/shared";
import { CLS_KEYS, getEffectiveBranchIds } from "../../common/request-context";
import { PrismaService, type TxClient } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";

const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

interface WorkingHours {
  openingTime: string;
  closingTime: string;
  weeklyOffDays: string[];
}

function parseWorkingHours(json: Prisma.JsonValue | null | undefined): WorkingHours {
  const v = (json ?? {}) as Partial<WorkingHours>;
  return {
    openingTime: v.openingTime ?? "09:00",
    closingTime: v.closingTime ?? "18:00",
    weeklyOffDays: v.weeklyOffDays ?? [],
  };
}

function dateOnlyUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Parses a "YYYY-MM-DD" route/query param into a UTC-midnight Date. */
function parseDateParam(dateStr: string): Date {
  const parts = dateStr.split("-").map(Number);
  return new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!));
}

function todayUtc(): Date {
  return dateOnlyUtc(new Date());
}

function weekdayName(date: Date): string {
  return WEEKDAY_NAMES[date.getUTCDay()]!;
}

function isLate(checkInAt: Date, date: Date, openingTime: string): boolean {
  const [hour, minute] = openingTime.split(":").map(Number);
  const threshold = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute));
  threshold.setUTCMinutes(threshold.getUTCMinutes() + ATTENDANCE_LATE_GRACE_MINUTES);
  return checkInAt.getTime() > threshold.getTime();
}

/**
 * Status for a staff+date with NO `attendance_days` row at all — never
 * guessed, derived purely from where `date` sits relative to `today` and the
 * branch's weekly-off days. `pending` is intentionally never "absent" before
 * the day is actually over (confirmed decision, docs/MODULES/attendance.md).
 */
function deriveMissingRowStatus(date: Date, today: Date, weeklyOffDays: string[]): AttendanceDayStatus {
  if (date.getTime() > today.getTime()) return "pending";
  if (weeklyOffDays.includes(weekdayName(date))) return "weekly_off";
  if (date.getTime() === today.getTime()) return "pending";
  return "absent";
}

type SessionRow = { id: string; checkInAt: Date; checkOutAt: Date | null; source: "self" | "manual" };

function toSessionsResponse(sessions: SessionRow[]): AttendanceSessionResponse[] {
  const sorted = [...sessions].sort((a, b) => a.checkInAt.getTime() - b.checkInAt.getTime());
  return sorted.map((session, i) => {
    const previous = sorted[i - 1];
    const breakMinutesBefore = previous?.checkOutAt
      ? Math.round((session.checkInAt.getTime() - previous.checkOutAt.getTime()) / 60_000)
      : null;
    return {
      id: session.id,
      checkInAt: session.checkInAt,
      checkOutAt: session.checkOutAt,
      source: session.source,
      breakMinutesBefore,
    };
  });
}

function computeDayFields(
  sessions: SessionRow[],
  date: Date,
  openingTime: string,
): { status: AttendanceDayStatus; firstInAt: Date | null; lastOutAt: Date | null; totalWorkedMinutes: number } {
  if (sessions.length === 0) {
    return { status: "pending", firstInAt: null, lastOutAt: null, totalWorkedMinutes: 0 };
  }
  const sorted = [...sessions].sort((a, b) => a.checkInAt.getTime() - b.checkInAt.getTime());
  const firstInAt = sorted[0]!.checkInAt;
  const closed = sorted.filter((s) => s.checkOutAt !== null);
  const lastOutAt = closed.length ? closed[closed.length - 1]!.checkOutAt : null;
  const totalWorkedMinutes = closed.reduce(
    (sum, s) => sum + Math.round((s.checkOutAt!.getTime() - s.checkInAt.getTime()) / 60_000),
    0,
  );
  const status: AttendanceDayStatus = isLate(firstInAt, date, openingTime) ? "late" : "present";
  return { status, firstInAt, lastOutAt, totalWorkedMinutes };
}

function paginate<T>(items: T[], page: number, pageSize: number): Paginated<T> {
  const start = (page - 1) * pageSize;
  return { data: items.slice(start, start + pageSize), meta: { page, pageSize, total: items.length } };
}

const ELIGIBLE_STAFF_SELECT = {
  id: true,
  primaryBranchId: true,
  primaryBranch: { select: { nameEn: true, workingHours: true } },
  user: { select: { name: true } },
} satisfies Prisma.StaffProfileSelect;

type EligibleStaffRow = Prisma.StaffProfileGetPayload<{ select: typeof ELIGIBLE_STAFF_SELECT }>;

function staffRef(s: EligibleStaffRow): { id: string; name: string; branchName: string | null } {
  return { id: s.id, name: s.user.name, branchName: s.primaryBranch?.nameEn ?? null };
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
  ) {}

  // ───────────────────────── Self-service ─────────────────────────

  async checkIn(): Promise<MyAttendanceToday> {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const userId = this.cls.get(CLS_KEYS.userId) as string;
    const profile = await this.resolveOwnStaffProfile(userId);
    const today = todayUtc();

    return this.prisma.withTenantTx(async (tx) => {
      let day = await tx.attendanceDay.findUnique({
        where: { tenantId_staffProfileId_date: { tenantId, staffProfileId: profile.id, date: today } },
        include: { sessions: { orderBy: { checkInAt: "desc" }, take: 1 } },
      });
      if (day?.sessions[0] && day.sessions[0].checkOutAt === null) {
        throw new ConflictException({
          code: ERROR_CODES.ATTENDANCE_ALREADY_CHECKED_IN,
          message: "Already checked in",
        });
      }
      if (!day) {
        day = await tx.attendanceDay.create({
          data: { tenantId, staffProfileId: profile.id, date: today, status: "pending" },
          include: { sessions: { orderBy: { checkInAt: "desc" }, take: 1 } },
        });
      }
      await tx.attendanceSession.create({
        data: { tenantId, attendanceDayId: day.id, checkInAt: new Date(), source: "self", createdByUserId: userId },
      });
      const updated = await this.recomputeDay(tx, day.id);
      return toMyAttendanceToday(updated);
    });
  }

  async checkOut(): Promise<MyAttendanceToday> {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const userId = this.cls.get(CLS_KEYS.userId) as string;
    const profile = await this.resolveOwnStaffProfile(userId);
    const today = todayUtc();

    return this.prisma.withTenantTx(async (tx) => {
      const day = await tx.attendanceDay.findUnique({
        where: { tenantId_staffProfileId_date: { tenantId, staffProfileId: profile.id, date: today } },
        include: { sessions: { orderBy: { checkInAt: "desc" }, take: 1 } },
      });
      const openSession = day?.sessions[0];
      if (!day || !openSession || openSession.checkOutAt !== null) {
        throw new ConflictException({
          code: ERROR_CODES.ATTENDANCE_NOT_CHECKED_IN,
          message: "Not currently checked in",
        });
      }
      await tx.attendanceSession.update({ where: { id: openSession.id }, data: { checkOutAt: new Date() } });
      const updated = await this.recomputeDay(tx, day.id);
      return toMyAttendanceToday(updated);
    });
  }

  async getMyToday(): Promise<MyAttendanceToday> {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const userId = this.cls.get(CLS_KEYS.userId) as string;
    const profile = await this.resolveOwnStaffProfile(userId);
    const today = todayUtc();

    const day = await this.prisma.client.attendanceDay.findUnique({
      where: { tenantId_staffProfileId_date: { tenantId, staffProfileId: profile.id, date: today } },
      include: { sessions: { orderBy: { checkInAt: "asc" } } },
    });
    if (!day) {
      return { isCheckedIn: false, firstInAt: null, lastOutAt: null, totalWorkedMinutes: 0, sessions: [] };
    }
    return toMyAttendanceToday(day);
  }

  private async resolveOwnStaffProfile(userId: string): Promise<{ id: string }> {
    const profile = await this.prisma.client.staffProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) {
      throw new NotFoundException({
        code: ERROR_CODES.ATTENDANCE_NO_STAFF_PROFILE,
        message: "No staff profile for current user",
      });
    }
    return profile;
  }

  // ───────────────────────── Branch-scoped views ─────────────────────────

  async list(
    query: ListAttendanceQuery,
  ): Promise<Paginated<AttendanceDaySummary | AttendanceMonthlyAggregate>> {
    return query.scope === "today" ? this.listToday(query) : this.listMonthly(query);
  }

  private async listToday(query: ListAttendanceQuery): Promise<Paginated<AttendanceDaySummary>> {
    if (!query.date) {
      throw new BadRequestException({ code: ERROR_CODES.VALIDATION_FAILED, message: "date is required" });
    }
    const date = parseDateParam(query.date);
    const today = todayUtc();
    const staff = await this.eligibleStaff(query.branchId, query.search);
    const dayRows = await this.prisma.client.attendanceDay.findMany({
      where: { date, staffProfileId: { in: staff.map((s) => s.id) } },
      include: { sessions: true },
    });
    const dayByStaff = new Map(dayRows.map((d) => [d.staffProfileId, d]));

    const summaries = staff.map((s) => {
      const day = dayByStaff.get(s.id);
      const workingHours = parseWorkingHours(s.primaryBranch?.workingHours);
      if (day) {
        return {
          staff: staffRef(s),
          date,
          status: day.status,
          firstInAt: day.firstInAt,
          lastOutAt: day.lastOutAt,
          totalWorkedMinutes: day.totalWorkedMinutes,
          sessionCount: day.sessions.length,
        };
      }
      return {
        staff: staffRef(s),
        date,
        status: deriveMissingRowStatus(date, today, workingHours.weeklyOffDays),
        firstInAt: null,
        lastOutAt: null,
        totalWorkedMinutes: 0,
        sessionCount: 0,
      };
    });
    return paginate(summaries, query.page, query.pageSize);
  }

  private async listMonthly(query: ListAttendanceQuery): Promise<Paginated<AttendanceMonthlyAggregate>> {
    if (!query.month) {
      throw new BadRequestException({ code: ERROR_CODES.VALIDATION_FAILED, message: "month is required" });
    }
    const staff = await this.eligibleStaff(query.branchId, query.search);
    const aggregates = await this.computeMonthlyAggregates(staff, query.month);
    return paginate(aggregates, query.page, query.pageSize);
  }

  async getKpis(query: AttendanceKpisQuery): Promise<AttendanceKpis> {
    const staff = await this.eligibleStaff(query.branchId, query.search);

    if (query.scope === "today") {
      if (!query.date) {
        throw new BadRequestException({ code: ERROR_CODES.VALIDATION_FAILED, message: "date is required" });
      }
      const date = parseDateParam(query.date);
      const today = todayUtc();
      const dayRows = await this.prisma.client.attendanceDay.findMany({
        where: { date, staffProfileId: { in: staff.map((s) => s.id) } },
      });
      const dayByStaff = new Map(dayRows.map((d) => [d.staffProfileId, d]));

      let present = 0;
      let late = 0;
      let onLeave = 0;
      let absent = 0;
      let workingStaffCount = 0;
      for (const s of staff) {
        const workingHours = parseWorkingHours(s.primaryBranch?.workingHours);
        const status = dayByStaff.get(s.id)?.status ?? deriveMissingRowStatus(date, today, workingHours.weeklyOffDays);
        if (status === "weekly_off" || status === "pending" || status === "holiday") continue;
        workingStaffCount++;
        if (status === "present") present++;
        else if (status === "late") late++;
        else if (status === "on_leave") onLeave++;
        else if (status === "absent") absent++;
      }
      const attendanceRatePct = workingStaffCount ? round1((present + late) / workingStaffCount) : 0;
      return { present, late, onLeave, absent, attendanceRatePct };
    }

    if (!query.month) {
      throw new BadRequestException({ code: ERROR_CODES.VALIDATION_FAILED, message: "month is required" });
    }
    const aggregates = await this.computeMonthlyAggregates(staff, query.month);
    const present = aggregates.reduce((sum, a) => sum + a.presentDays, 0);
    const late = aggregates.reduce((sum, a) => sum + a.lateDays, 0);
    const onLeave = aggregates.reduce((sum, a) => sum + a.leaveDays, 0);
    const absent = aggregates.reduce((sum, a) => sum + a.absentDays, 0);
    const workingDaysSoFar = present + late + onLeave + absent;
    const attendanceRatePct = workingDaysSoFar ? round1((present + late) / workingDaysSoFar) : 0;
    return { present, late, onLeave, absent, attendanceRatePct };
  }

  async getDayDetail(staffProfileId: string, dateStr: string): Promise<AttendanceDayDetail> {
    const staffProfile = await this.loadStaffProfileForDetail(staffProfileId);
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const date = parseDateParam(dateStr);
    const today = todayUtc();

    const day = await this.prisma.client.attendanceDay.findUnique({
      where: { tenantId_staffProfileId_date: { tenantId, staffProfileId, date } },
      include: { sessions: true },
    });
    const workingHours = parseWorkingHours(staffProfile.primaryBranch?.workingHours);
    const ref = staffRef(staffProfile);
    if (!day) {
      return {
        staff: ref,
        date,
        status: deriveMissingRowStatus(date, today, workingHours.weeklyOffDays),
        firstInAt: null,
        lastOutAt: null,
        totalWorkedMinutes: 0,
        isManualEntry: false,
        editedByUserId: null,
        editedAt: null,
        sessions: [],
      };
    }
    return {
      staff: ref,
      date: day.date,
      status: day.status,
      firstInAt: day.firstInAt,
      lastOutAt: day.lastOutAt,
      totalWorkedMinutes: day.totalWorkedMinutes,
      isManualEntry: day.isManualEntry,
      editedByUserId: day.editedByUserId,
      editedAt: day.editedAt,
      sessions: toSessionsResponse(day.sessions),
    };
  }

  async getMonthlyDetail(staffProfileId: string, month: string): Promise<AttendanceMonthlyDetail> {
    const staffProfile = await this.loadStaffProfileForDetail(staffProfileId);
    const [summary] = await this.computeMonthlyAggregates([staffProfile], month);
    const bounds = payrollMonthBounds(month);
    const today = todayUtc();
    const workingHours = parseWorkingHours(staffProfile.primaryBranch?.workingHours);

    const rows = await this.prisma.client.attendanceDay.findMany({
      where: { staffProfileId, date: { gte: bounds.start, lte: bounds.end } },
      include: { sessions: true },
    });
    const rowByTime = new Map(rows.map((r) => [r.date.getTime(), r]));

    const days: AttendanceMonthlyDayRow[] = [];
    for (let t = bounds.start.getTime(); t <= bounds.end.getTime(); t += 86_400_000) {
      const d = new Date(t);
      const row = rowByTime.get(t);
      days.push(
        row
          ? {
              date: row.date,
              status: row.status,
              firstInAt: row.firstInAt,
              lastOutAt: row.lastOutAt,
              totalWorkedMinutes: row.totalWorkedMinutes,
              sessionCount: row.sessions.length,
            }
          : {
              date: d,
              status: deriveMissingRowStatus(d, today, workingHours.weeklyOffDays),
              firstInAt: null,
              lastOutAt: null,
              totalWorkedMinutes: 0,
              sessionCount: 0,
            },
      );
    }
    return { summary: summary!, days };
  }

  async updateDay(
    staffProfileId: string,
    dateStr: string,
    input: UpdateAttendanceDayInput,
  ): Promise<AttendanceDayDetail> {
    const staffProfile = await this.loadStaffProfileForDetail(staffProfileId);
    const date = parseDateParam(dateStr);
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const userId = this.cls.get(CLS_KEYS.userId) as string;

    return this.prisma.withTenantTx(async (tx) => {
      let day = await tx.attendanceDay.findUnique({
        where: { tenantId_staffProfileId_date: { tenantId, staffProfileId, date } },
      });
      if (!day) {
        day = await tx.attendanceDay.create({ data: { tenantId, staffProfileId, date, status: "pending" } });
      }
      await tx.attendanceSession.deleteMany({ where: { attendanceDayId: day.id } });
      if (input.sessions.length > 0) {
        await tx.attendanceSession.createMany({
          data: input.sessions.map((s) => ({
            tenantId,
            attendanceDayId: day!.id,
            checkInAt: s.checkInAt,
            checkOutAt: s.checkOutAt,
            source: "manual" as const,
            createdByUserId: userId,
          })),
        });
      }
      await tx.attendanceDay.update({
        where: { id: day.id },
        data: { isManualEntry: true, editedByUserId: userId, editedAt: new Date() },
      });
      const updated = await this.recomputeDay(tx, day.id);
      await this.audit.log(
        {
          action: "attendance_day.edited",
          entityType: "attendance_day",
          entityId: day.id,
          after: { sessionCount: input.sessions.length },
        },
        tx,
      );
      const ref = staffRef(staffProfile);
      return {
        staff: ref,
        date: updated.date,
        status: updated.status,
        firstInAt: updated.firstInAt,
        lastOutAt: updated.lastOutAt,
        totalWorkedMinutes: updated.totalWorkedMinutes,
        isManualEntry: updated.isManualEntry,
        editedByUserId: updated.editedByUserId,
        editedAt: updated.editedAt,
        sessions: toSessionsResponse(updated.sessions),
      };
    });
  }

  /**
   * Counts genuine "absent" days (no attendance row, not weekly-off/holiday, in the past) for a
   * staff member within `[start, end]` — used by Payroll to compute the absence deduction. Reuses
   * the exact same per-day derivation (`deriveMissingRowStatus`) as every other Attendance view,
   * so a day counted "absent" here always matches what the Today/Monthly screens would show for it.
   */
  async countAbsentDays(staffProfileId: string, start: Date, end: Date): Promise<number> {
    if (start.getTime() > end.getTime()) return 0;
    const staffProfile = await this.prisma.client.staffProfile.findUnique({
      where: { id: staffProfileId },
      select: { primaryBranch: { select: { workingHours: true } } },
    });
    const weeklyOffDays = parseWorkingHours(staffProfile?.primaryBranch?.workingHours).weeklyOffDays;
    const today = todayUtc();

    const rows = await this.prisma.client.attendanceDay.findMany({
      where: { staffProfileId, date: { gte: start, lte: end } },
      select: { date: true, status: true },
    });
    const statusByTime = new Map(rows.map((r) => [r.date.getTime(), r.status]));

    let absentDays = 0;
    for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
      const d = new Date(t);
      const status = statusByTime.get(t) ?? deriveMissingRowStatus(d, today, weeklyOffDays);
      if (status === "absent") absentDays++;
    }
    return absentDays;
  }

  // ───────────────────────── Shared helpers ─────────────────────────

  /** Recomputes and persists a day's status/firstIn/lastOut/totalWorked from its current sessions. */
  private async recomputeDay(tx: TxClient, dayId: string) {
    const day = await tx.attendanceDay.findUniqueOrThrow({
      where: { id: dayId },
      include: { sessions: true, staffProfile: { include: { primaryBranch: true } } },
    });
    const workingHours = parseWorkingHours(day.staffProfile.primaryBranch?.workingHours);
    const fields = computeDayFields(day.sessions, day.date, workingHours.openingTime);
    return tx.attendanceDay.update({
      where: { id: dayId },
      data: {
        status: fields.status,
        firstInAt: fields.firstInAt,
        lastOutAt: fields.lastOutAt,
        totalWorkedMinutes: fields.totalWorkedMinutes,
      },
      include: { sessions: { orderBy: { checkInAt: "asc" } } },
    });
  }

  private async loadStaffProfileForDetail(staffProfileId: string): Promise<EligibleStaffRow> {
    const staffProfile = await this.prisma.client.staffProfile.findUnique({
      where: { id: staffProfileId },
      select: ELIGIBLE_STAFF_SELECT,
    });
    if (!staffProfile) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Staff not found" });
    }
    this.assertStaffBranchAccess(staffProfile.primaryBranchId);
    return staffProfile;
  }

  private assertBranchAccess(branchId: string): void {
    const effective = getEffectiveBranchIds(this.cls);
    if (effective && !effective.includes(branchId)) {
      throw new ForbiddenException({ code: ERROR_CODES.BRANCH_ACCESS_DENIED, message: "Branch access denied" });
    }
  }

  private assertStaffBranchAccess(primaryBranchId: string | null): void {
    const effective = getEffectiveBranchIds(this.cls);
    if (effective && (!primaryBranchId || !effective.includes(primaryBranchId))) {
      throw new ForbiddenException({ code: ERROR_CODES.BRANCH_ACCESS_DENIED, message: "Branch access denied" });
    }
  }

  private async eligibleStaff(branchId?: string, search?: string): Promise<EligibleStaffRow[]> {
    const effective = getEffectiveBranchIds(this.cls);
    let primaryBranchId: Prisma.StaffProfileWhereInput["primaryBranchId"];
    // "All branches" (no explicit branchId) excludes inactive branches' staff; an explicit
    // branchId is trusted as-is (the branch picker only ever lists active branches anyway).
    let requireActiveBranch = false;
    if (branchId) {
      this.assertBranchAccess(branchId);
      primaryBranchId = branchId;
    } else {
      requireActiveBranch = true;
      if (effective) primaryBranchId = { in: effective };
    }
    return this.prisma.client.staffProfile.findMany({
      where: {
        primaryBranchId: primaryBranchId ?? { not: null },
        ...(requireActiveBranch ? { primaryBranch: { status: "active" } } : {}),
        user: {
          status: "active",
          deletedAt: null,
          ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
        },
      },
      select: ELIGIBLE_STAFF_SELECT,
      orderBy: { user: { name: "asc" } },
    });
  }

  /**
   * Per-staff monthly totals. Combines real `attendance_days` rows with
   * synthesized status for days without one (so a staff member who never
   * once checked in all month still shows the correct absent/weekly-off
   * counts) — a bounded day-by-day loop (<=31 days per staff), not a raw
   * `groupBy` alone, since `groupBy` only sees rows that actually exist.
   * Stops at `today` for the current month so future days are never counted.
   */
  private async computeMonthlyAggregates(
    staff: EligibleStaffRow[],
    month: string,
  ): Promise<AttendanceMonthlyAggregate[]> {
    const bounds = payrollMonthBounds(month);
    const today = todayUtc();
    const evaluatedEnd = bounds.end.getTime() < today.getTime() ? bounds.end : today;

    const rows =
      staff.length === 0
        ? []
        : await this.prisma.client.attendanceDay.findMany({
            where: { staffProfileId: { in: staff.map((s) => s.id) }, date: { gte: bounds.start, lte: bounds.end } },
          });
    const rowsByStaff = new Map<string, Map<number, (typeof rows)[number]>>();
    for (const r of rows) {
      if (!rowsByStaff.has(r.staffProfileId)) rowsByStaff.set(r.staffProfileId, new Map());
      rowsByStaff.get(r.staffProfileId)!.set(r.date.getTime(), r);
    }

    return staff.map((s) => {
      const workingHours = parseWorkingHours(s.primaryBranch?.workingHours);
      const staffRows = rowsByStaff.get(s.id) ?? new Map();
      let presentDays = 0;
      let lateDays = 0;
      let leaveDays = 0;
      let absentDays = 0;
      let totalWorkedMinutes = 0;
      let workingDaysSoFar = 0;

      for (let t = bounds.start.getTime(); t <= evaluatedEnd.getTime(); t += 86_400_000) {
        const d = new Date(t);
        const row = staffRows.get(t);
        const status = row?.status ?? deriveMissingRowStatus(d, today, workingHours.weeklyOffDays);
        totalWorkedMinutes += row?.totalWorkedMinutes ?? 0;
        if (status === "weekly_off" || status === "pending" || status === "holiday") continue;
        workingDaysSoFar++;
        if (status === "present") presentDays++;
        else if (status === "late") lateDays++;
        else if (status === "on_leave") leaveDays++;
        else if (status === "absent") absentDays++;
      }

      return {
        staff: staffRef(s),
        month,
        presentDays,
        lateDays,
        leaveDays,
        absentDays,
        totalWorkedMinutes,
        attendanceRatePct: workingDaysSoFar ? round1((presentDays + lateDays) / workingDaysSoFar) : 0,
      };
    });
  }
}

function round1(fraction: number): number {
  return Math.round(fraction * 1000) / 10;
}

function toMyAttendanceToday(day: {
  firstInAt: Date | null;
  lastOutAt: Date | null;
  totalWorkedMinutes: number;
  sessions: SessionRow[];
}): MyAttendanceToday {
  const sorted = [...day.sessions].sort((a, b) => a.checkInAt.getTime() - b.checkInAt.getTime());
  const last = sorted[sorted.length - 1];
  return {
    isCheckedIn: !!last && last.checkOutAt === null,
    firstInAt: day.firstInAt,
    lastOutAt: day.lastOutAt,
    totalWorkedMinutes: day.totalWorkedMinutes,
    sessions: toSessionsResponse(day.sessions),
  };
}

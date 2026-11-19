import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  ERROR_CODES,
  LEAVE_TAB_STATUSES,
  type CancelLeaveRequestInput,
  type CreateLeaveRequestInput,
  type LeaveBalance as LeaveBalanceResponse,
  type LeaveHistoryEntry,
  type LeaveKpis,
  type LeaveKpisQuery,
  type LeaveRequestDetail,
  type LeaveRequestSummary,
  type ListLeaveRequestsQuery,
  type ListMyLeaveRequestsQuery,
  type Paginated,
  type PresignedUpload,
  type PresignLeaveAttachmentInput,
  type RejectLeaveRequestInput,
} from "@keystonehr/shared";
import { CLS_KEYS, getEffectiveBranchIds } from "../../common/request-context";
import { PrismaService, type TxClient } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";
import { closingBalance, ensureYearBalance } from "./leave-balance.util";
import { accrueIfDue, type LeaveTypeForAccrual } from "./leave-accrual.job";

const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function parseWeeklyOffDays(json: Prisma.JsonValue | null | undefined): string[] {
  const v = (json ?? {}) as Partial<{ weeklyOffDays: string[] }>;
  return v.weeklyOffDays ?? [];
}

function dateOnlyUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function todayUtc(): Date {
  return dateOnlyUtc(new Date());
}

function daysBetweenInclusive(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cur = new Date(start);
  while (cur.getTime() <= end.getTime()) {
    days.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

interface HalfDayInput {
  startHalfDay: boolean;
  endHalfDay: boolean;
  halfDayPeriod?: "first_half" | "second_half";
}

/**
 * A single-day request is 1 (or 0.5 with `halfDayPeriod`, or 0 if that one day is itself a
 * skipped weekly-off day). A range counts its countable days, then deducts 0.5 for each of
 * `startHalfDay`/`endHalfDay` that lands on a day actually counted — a half-day flag on a
 * boundary that's already excluded as a weekly-off day doesn't double-dip.
 */
function computeDaysCount(
  start: Date,
  end: Date,
  countMode: string,
  weeklyOffDays: string[],
  half: HalfDayInput,
): number {
  const days = daysBetweenInclusive(start, end);
  const countable = countMode === "all_days" ? days : days.filter((d) => !weeklyOffDays.includes(WEEKDAY_NAMES[d.getUTCDay()]!));

  if (start.getTime() === end.getTime()) {
    if (countable.length === 0) return 0;
    return half.halfDayPeriod ? 0.5 : 1;
  }

  let count = countable.length;
  if (half.startHalfDay && countable.some((d) => d.getTime() === start.getTime())) count -= 0.5;
  if (half.endHalfDay && countable.some((d) => d.getTime() === end.getTime())) count -= 0.5;
  return count;
}

const ACTIVE_LEAVE_STATUSES = [...LEAVE_TAB_STATUSES.pending, "approved"] as const;

type DayPortion = "full" | "first" | "second";

/**
 * Per-day occupancy of a request: every day is `"full"` except a single-day request's own day
 * (follows `halfDayPeriod`) and a range's start/end day (follows the same half-day convention as
 * the UI copy — a half-day start leaves the day's second half free, a half-day end leaves the
 * day's first half free). Two requests conflict on a shared day unless both sides are opposite
 * halves of it.
 */
function dayPortions(start: Date, end: Date, half: HalfDayInput): Map<number, DayPortion> {
  const map = new Map<number, DayPortion>();
  if (start.getTime() === end.getTime()) {
    const portion: DayPortion = half.halfDayPeriod === "first_half" ? "first" : half.halfDayPeriod === "second_half" ? "second" : "full";
    map.set(start.getTime(), portion);
    return map;
  }
  for (const d of daysBetweenInclusive(start, end)) {
    let portion: DayPortion = "full";
    if (half.startHalfDay && d.getTime() === start.getTime()) portion = "second";
    if (half.endHalfDay && d.getTime() === end.getTime()) portion = "first";
    map.set(d.getTime(), portion);
  }
  return map;
}

function portionsConflict(a: DayPortion, b: DayPortion): boolean {
  if (a === "full" || b === "full") return true;
  return a === b;
}

type EmployeeWithRefs = Prisma.EmployeeProfileGetPayload<{
  include: { user: { include: { role: true } }; primaryBranch: true };
}>;

function employeeRef(e: EmployeeWithRefs): { id: string; name: string; branchName: string | null; role: string | null } {
  return {
    id: e.id,
    name: e.user.name,
    branchName: e.primaryBranch?.nameEn ?? null,
    role: e.user.role?.nameEn ?? null,
  };
}

function leaveTypeRef(t: { id: string; nameEn: string; nameAr: string; isPaid: boolean }) {
  return { id: t.id, nameEn: t.nameEn, nameAr: t.nameAr, isPaid: t.isPaid };
}

type RequestWithRefs = Prisma.LeaveRequestGetPayload<{
  include: { employeeProfile: { include: { user: { include: { role: true } }; primaryBranch: true } }; leaveType: true };
}>;

function toSummary(row: RequestWithRefs): LeaveRequestSummary {
  return {
    id: row.id,
    employee: employeeRef(row.employeeProfile),
    leaveType: leaveTypeRef(row.leaveType),
    startDate: row.startDate,
    endDate: row.endDate,
    startHalfDay: row.startHalfDay,
    endHalfDay: row.endHalfDay,
    halfDayPeriod: row.halfDayPeriod,
    daysCount: Number(row.daysCount),
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt,
  };
}

const REQUEST_INCLUDE = {
  employeeProfile: { include: { user: { include: { role: true } }, primaryBranch: true } },
  leaveType: true,
} satisfies Prisma.LeaveRequestInclude;

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
    private readonly storage: StorageService,
  ) {}

  // ───────────────────────── Requests ─────────────────────────

  async create(input: CreateLeaveRequestInput): Promise<LeaveRequestSummary> {
    const userId = this.cls.get(CLS_KEYS.userId) as string;

    const employeeProfileId = input.employeeProfileId ?? (await this.resolveOwnEmployeeProfile(userId)).id;
    const employee = await this.loadEmployee(employeeProfileId);
    if (input.employeeProfileId) this.assertEmployeeBranchAccess(employee.primaryBranchId);

    const leaveType = await this.prisma.client.leaveType.findUnique({ where: { id: input.leaveTypeId } });
    if (!leaveType || !leaveType.isActive) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Leave type not found" });
    }
    const requestsHalfDay = input.startHalfDay || input.endHalfDay || !!input.halfDayPeriod;
    if (!leaveType.allowHalfDay && requestsHalfDay) {
      throw new BadRequestException({
        code: ERROR_CODES.LEAVE_HALF_DAY_NOT_ALLOWED,
        message: "This leave type does not allow half-day requests",
      });
    }
    if (leaveType.requireSupportingDocument && !input.attachmentKey) {
      throw new BadRequestException({
        code: ERROR_CODES.LEAVE_SUPPORTING_DOCUMENT_REQUIRED,
        message: "A supporting document is required for this leave type",
      });
    }
    const noticeDays = Math.round((input.startDate.getTime() - todayUtc().getTime()) / 86_400_000);
    if (noticeDays < leaveType.minimumNoticeDays) {
      throw new BadRequestException({
        code: ERROR_CODES.LEAVE_MINIMUM_NOTICE_NOT_MET,
        message: `This leave type requires at least ${leaveType.minimumNoticeDays} day(s) notice`,
      });
    }
    if (!employee.primaryBranchId) {
      throw new BadRequestException({ code: ERROR_CODES.VALIDATION_FAILED, message: "Employee has no primary branch" });
    }

    const weeklyOffDays = parseWeeklyOffDays(employee.primaryBranch?.workingHours);
    const daysCount = computeDaysCount(input.startDate, input.endDate, leaveType.countMode, weeklyOffDays, input);
    const year = input.startDate.getUTCFullYear();

    return this.prisma.client.$transaction(async (tx) => {
      await this.assertNoDateConflict(tx, employeeProfileId, input);

      const balance = await ensureYearBalance(tx, {
        employeeProfileId,
        leaveTypeId: leaveType.id,
        year,
        allowCarryForward: leaveType.allowCarryForward,
        maxCarryForwardDays: leaveType.maxCarryForwardDays,
      });
      if (!leaveType.allowNegativeBalance && daysCount > closingBalance(balance)) {
        throw new BadRequestException({
          code: ERROR_CODES.LEAVE_INSUFFICIENT_BALANCE,
          message: "Insufficient leave balance for this request",
        });
      }

      const created = await tx.leaveRequest.create({
        data: {
          employeeProfileId,
          leaveTypeId: leaveType.id,
          branchId: employee.primaryBranchId!,
          startDate: input.startDate,
          endDate: input.endDate,
          startHalfDay: input.startHalfDay,
          endHalfDay: input.endHalfDay,
          halfDayPeriod: input.halfDayPeriod ?? null,
          daysCount,
          reason: input.reason ?? null,
          attachmentKey: input.attachmentKey ?? null,
          createdByUserId: userId,
        },
        include: REQUEST_INCLUDE,
      });
      await this.audit.log(
        {
          action: "leave_request.created",
          entityType: "leave_request",
          entityId: created.id,
          after: { status: created.status, daysCount: Number(created.daysCount) },
        },
        tx,
      );
      return toSummary(created);
    });
  }

  async list(query: ListLeaveRequestsQuery): Promise<Paginated<LeaveRequestSummary>> {
    const where = this.buildListWhere(query);
    const [rows, total] = await Promise.all([
      this.prisma.client.leaveRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.client.leaveRequest.count({ where }),
    ]);
    return { data: rows.map(toSummary), meta: { page: query.page, pageSize: query.pageSize, total } };
  }

  /** Self-scoped equivalent of `list()` — every row belongs to the caller, no branch/search filter. */
  async listMine(query: ListMyLeaveRequestsQuery): Promise<Paginated<LeaveRequestSummary>> {
    const userId = this.cls.get(CLS_KEYS.userId) as string;
    const { id: employeeProfileId } = await this.resolveOwnEmployeeProfile(userId);
    const statuses = query.tab ? LEAVE_TAB_STATUSES[query.tab] : undefined;
    const where: Prisma.LeaveRequestWhereInput = {
      employeeProfileId,
      ...(statuses ? { status: { in: [...statuses] } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.leaveRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.client.leaveRequest.count({ where }),
    ]);
    return { data: rows.map(toSummary), meta: { page: query.page, pageSize: query.pageSize, total } };
  }

  async getKpis(query: LeaveKpisQuery): Promise<LeaveKpis> {
    const branchWhere = this.buildBranchWhere(query.branchId);
    const today = todayUtc();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

    const [pending, approvedThisMonth, onLeaveToday, rejected] = await Promise.all([
      this.prisma.client.leaveRequest.count({
        where: { ...branchWhere, status: { in: [...LEAVE_TAB_STATUSES.pending] } },
      }),
      this.prisma.client.leaveRequest.count({
        where: { ...branchWhere, status: "approved", approvedAt: { gte: monthStart } },
      }),
      this.prisma.client.leaveRequest.count({
        where: { ...branchWhere, status: "approved", startDate: { lte: today }, endDate: { gte: today } },
      }),
      this.prisma.client.leaveRequest.count({ where: { ...branchWhere, status: "rejected" } }),
    ]);
    return { pending, approvedThisMonth, onLeaveToday, rejected };
  }

  async approve(id: string): Promise<LeaveRequestSummary> {
    const userId = this.cls.get(CLS_KEYS.userId) as string;

    return this.prisma.client.$transaction(async (tx) => {
      const request = await this.loadRequestForTransition(tx, id);
      const leaveType = await tx.leaveType.findUniqueOrThrow({ where: { id: request.leaveTypeId } });
      const now = new Date();

      let updated: RequestWithRefs;
      if (leaveType.requiresSecondApproval && request.status === "pending") {
        updated = await tx.leaveRequest.update({
          where: { id },
          data: { status: "pending_second_approval", firstApproverId: userId, firstApprovedAt: now },
          include: REQUEST_INCLUDE,
        });
      } else {
        const balance = await ensureYearBalance(tx, {
          employeeProfileId: request.employeeProfileId,
          leaveTypeId: leaveType.id,
          year: request.startDate.getUTCFullYear(),
          allowCarryForward: leaveType.allowCarryForward,
          maxCarryForwardDays: leaveType.maxCarryForwardDays,
        });
        if (!leaveType.allowNegativeBalance && Number(request.daysCount) > closingBalance(balance)) {
          throw new BadRequestException({
            code: ERROR_CODES.LEAVE_INSUFFICIENT_BALANCE,
            message: "Insufficient leave balance to approve this request",
          });
        }
        await tx.leaveBalance.update({ where: { id: balance.id }, data: { used: { increment: Number(request.daysCount) } } });

        updated = await tx.leaveRequest.update({
          where: { id },
          data: {
            status: "approved",
            approverUserId: userId,
            approvedAt: now,
            ...(request.status === "pending" ? { firstApproverId: userId, firstApprovedAt: now } : {}),
          },
          include: REQUEST_INCLUDE,
        });

        await this.markAttendanceOnLeave(tx, request.employeeProfileId, request.startDate, request.endDate);
      }

      await this.audit.log(
        {
          action: updated.status === "pending_second_approval" ? "leave_request.first_approved" : "leave_request.approved",
          entityType: "leave_request",
          entityId: id,
          after: { status: updated.status },
        },
        tx,
      );
      return toSummary(updated);
    });
  }

  async reject(id: string, input: RejectLeaveRequestInput): Promise<LeaveRequestSummary> {
    const userId = this.cls.get(CLS_KEYS.userId) as string;

    return this.prisma.client.$transaction(async (tx) => {
      await this.loadRequestForTransition(tx, id);
      const updated = await tx.leaveRequest.update({
        where: { id },
        data: {
          status: "rejected",
          approverUserId: userId,
          approvedAt: new Date(),
          rejectionReason: input.rejectionReason,
        },
        include: REQUEST_INCLUDE,
      });
      await this.audit.log(
        {
          action: "leave_request.rejected",
          entityType: "leave_request",
          entityId: id,
          after: { status: "rejected", rejectionReason: input.rejectionReason },
        },
        tx,
      );
      return toSummary(updated);
    });
  }

  /** Reverses an approved request's balance deduction and any `on_leave` attendance it set. */
  async cancel(id: string, input: CancelLeaveRequestInput): Promise<LeaveRequestSummary> {
    const userId = this.cls.get(CLS_KEYS.userId) as string;

    return this.prisma.client.$transaction(async (tx) => {
      const request = await tx.leaveRequest.findUnique({ where: { id } });
      if (!request) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Leave request not found" });
      }
      this.assertBranchAccess(request.branchId);
      if (request.status !== "approved") {
        throw new ConflictException({
          code: ERROR_CODES.LEAVE_REQUEST_NOT_APPROVED,
          message: "Only an approved request can be cancelled",
        });
      }
      const leaveType = await tx.leaveType.findUniqueOrThrow({ where: { id: request.leaveTypeId } });

      const balance = await ensureYearBalance(tx, {
        employeeProfileId: request.employeeProfileId,
        leaveTypeId: request.leaveTypeId,
        year: request.startDate.getUTCFullYear(),
        allowCarryForward: leaveType.allowCarryForward,
        maxCarryForwardDays: leaveType.maxCarryForwardDays,
      });
      await tx.leaveBalance.update({
        where: { id: balance.id },
        data: { used: { decrement: Number(request.daysCount) } },
      });
      await this.revertAttendanceOnLeave(tx, request.employeeProfileId, request.startDate, request.endDate);

      const updated = await tx.leaveRequest.update({
        where: { id },
        data: {
          status: "cancelled",
          approverUserId: userId,
          approvedAt: new Date(),
          rejectionReason: input.cancellationReason,
        },
        include: REQUEST_INCLUDE,
      });
      await this.audit.log(
        {
          action: "leave_request.cancelled",
          entityType: "leave_request",
          entityId: id,
          after: { status: "cancelled", cancellationReason: input.cancellationReason },
        },
        tx,
      );
      return toSummary(updated);
    });
  }

  /**
   * Self-service withdrawal of the caller's own still-undecided request — unlike `cancel()`
   * (approver reverses an approved leave), nothing has been applied yet, so this is just a status
   * flip: no balance or attendance changes.
   */
  async withdraw(id: string): Promise<LeaveRequestSummary> {
    const userId = this.cls.get(CLS_KEYS.userId) as string;

    return this.prisma.client.$transaction(async (tx) => {
      const request = await tx.leaveRequest.findUnique({ where: { id } });
      if (!request) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Leave request not found" });
      }
      const { id: employeeProfileId } = await this.resolveOwnEmployeeProfile(userId);
      if (request.employeeProfileId !== employeeProfileId) {
        throw new ForbiddenException({
          code: ERROR_CODES.PERMISSION_DENIED,
          message: "You can only cancel your own leave request",
        });
      }
      if (request.status !== "pending" && request.status !== "pending_second_approval") {
        throw new ConflictException({
          code: ERROR_CODES.LEAVE_REQUEST_NOT_PENDING,
          message: "This request has already been resolved",
        });
      }

      const updated = await tx.leaveRequest.update({
        where: { id },
        data: { status: "cancelled" },
        include: REQUEST_INCLUDE,
      });
      await this.audit.log(
        {
          action: "leave_request.cancelled",
          entityType: "leave_request",
          entityId: id,
          after: { status: "cancelled" },
        },
        tx,
      );
      return toSummary(updated);
    });
  }

  // ───────────────────────── Balances ─────────────────────────

  async getMyBalances(): Promise<LeaveBalanceResponse[]> {
    const userId = this.cls.get(CLS_KEYS.userId) as string;
    const profile = await this.resolveOwnEmployeeProfile(userId);
    return this.getBalancesFor(profile.id);
  }

  async getBalancesFor(employeeProfileId: string): Promise<LeaveBalanceResponse[]> {
    const employee = await this.loadEmployee(employeeProfileId);
    this.assertEmployeeBranchAccess(employee.primaryBranchId);

    const year = todayUtc().getUTCFullYear();
    const types = await this.prisma.client.leaveType.findMany({ where: { isActive: true } });

    return this.prisma.client.$transaction(async (tx) => {
      const rows: LeaveBalanceResponse[] = [];
      for (const type of types) {
        const balance = await ensureYearBalance(tx, {
          employeeProfileId,
          leaveTypeId: type.id,
          year,
          allowCarryForward: type.allowCarryForward,
          maxCarryForwardDays: type.maxCarryForwardDays,
        });
        rows.push({
          leaveTypeId: type.id,
          leaveTypeNameEn: type.nameEn,
          leaveTypeNameAr: type.nameAr,
          year,
          openingBalance: Number(balance.openingBalance),
          accrued: Number(balance.accrued),
          used: Number(balance.used),
          carriedForward: Number(balance.carriedForward),
          closingBalance: closingBalance(balance),
        });
      }
      return rows;
    });
  }

  /**
   * Sums `daysCount` for an employee's approved requests against an UNPAID leave type whose
   * `startDate` falls within `[monthStart, monthEnd]` — used by Payroll to reduce `paidDays` for
   * unpaid-leave proration (docs/MODULES/leave.md Integrations: "reduces paidDays ... exactly like
   * the existing Date-of-Join proration"). A request spanning a payroll-month boundary counts its
   * whole stored `daysCount` toward the month its `startDate` falls in — no day-by-day re-clipping
   * across the boundary (a stated v1 simplification; neither payroll.md nor this doc specifies the
   * cross-boundary case).
   */
  async getUnpaidLeaveDays(employeeProfileId: string, monthStart: Date, monthEnd: Date): Promise<number> {
    const result = await this.prisma.client.leaveRequest.aggregate({
      where: {
        employeeProfileId,
        status: "approved",
        startDate: { gte: monthStart, lte: monthEnd },
        leaveType: { isPaid: false },
      },
      _sum: { daysCount: true },
    });
    return Number(result._sum.daysCount ?? 0);
  }

  /**
   * Eagerly credits every currently-eligible employee's balance for a just-created leave
   * type, rather than leaving it at `accrued: 0` until the next nightly leave-accrual run (see
   * leave-accrual.job.ts) — called from `LeaveTypesService.create()`.
   */
  async creditNewLeaveType(leaveType: LeaveTypeForAccrual): Promise<void> {
    const today = dateOnlyUtc(new Date());

    // Same eligibility filter as the nightly job: a null joiningDate means "always eligible"
    // (see money.ts's paidDaysForJoin) — `{ lte: today }` alone would exclude those rows.
    const employees = await this.prisma.client.employeeProfile.findMany({
      where: {
        OR: [{ joiningDate: null }, { joiningDate: { lte: today } }],
        user: { status: "active", deletedAt: null },
      },
      select: { id: true, joiningDate: true },
    });

    for (const member of employees) {
      await this.prisma.client.$transaction((tx) =>
        accrueIfDue(tx, {
          employeeProfileId: member.id,
          joiningDate: member.joiningDate,
          leaveType,
          today,
        }),
      );
    }
  }

  // ───────────────────────── Detail & attachments ─────────────────────────

  async getDetail(id: string): Promise<LeaveRequestDetail> {
    const row = await this.prisma.client.leaveRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE });
    if (!row) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Leave request not found" });
    }
    this.assertBranchAccess(row.branchId);

    const history = await this.buildHistory(id);
    return {
      ...toSummary(row),
      branchId: row.branchId,
      firstApproverId: row.firstApproverId,
      firstApprovedAt: row.firstApprovedAt,
      approverUserId: row.approverUserId,
      approvedAt: row.approvedAt,
      rejectionReason: row.rejectionReason,
      createdByUserId: row.createdByUserId,
      attachmentKey: row.attachmentKey,
      history,
    };
  }

  /** Reconstructs the approval timeline from the audit log — nothing extra is stored for this. */
  private async buildHistory(leaveRequestId: string): Promise<LeaveHistoryEntry[]> {
    const entries = await this.prisma.client.auditLog.findMany({
      where: { entityType: "leave_request", entityId: leaveRequestId },
      orderBy: { createdAt: "asc" },
    });
    const userIds = [...new Set(entries.map((e) => e.userId).filter((v): v is string => !!v))];
    const users = userIds.length
      ? await this.prisma.client.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    return entries.map((e) => {
      const after = (e.after ?? {}) as Record<string, unknown>;
      const note = (after.rejectionReason ?? after.cancellationReason) as string | undefined;
      return {
        action: e.action,
        actorUserId: e.userId,
        actorName: e.userId ? (nameById.get(e.userId) ?? null) : null,
        at: e.createdAt,
        note: note ?? null,
      };
    });
  }

  async presignUpload(input: PresignLeaveAttachmentInput): Promise<PresignedUpload> {
    const key = `leave-attachments/${randomUUID()}-${input.fileName}`;
    const uploadUrl = await this.storage.getUploadUrl(key, input.contentType);
    return { uploadUrl, key };
  }

  async getAttachmentUrl(id: string): Promise<{ url: string }> {
    const row = await this.prisma.client.leaveRequest.findUnique({
      where: { id },
      select: { branchId: true, attachmentKey: true },
    });
    if (!row) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Leave request not found" });
    }
    this.assertBranchAccess(row.branchId);
    if (!row.attachmentKey) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "No attachment on this request" });
    }
    return { url: await this.storage.getDownloadUrl(row.attachmentKey) };
  }

  // ───────────────────────── Shared helpers ─────────────────────────

  private buildBranchWhere(branchId?: string): Prisma.LeaveRequestWhereInput {
    if (branchId) {
      this.assertBranchAccess(branchId);
      return { branchId };
    }
    const effective = getEffectiveBranchIds(this.cls);
    return effective ? { branchId: { in: effective } } : {};
  }

  private buildListWhere(query: ListLeaveRequestsQuery): Prisma.LeaveRequestWhereInput {
    const statuses = query.tab ? LEAVE_TAB_STATUSES[query.tab] : undefined;
    return {
      ...this.buildBranchWhere(query.branchId),
      ...(statuses ? { status: { in: [...statuses] } } : {}),
      ...(query.leaveTypeId ? { leaveTypeId: query.leaveTypeId } : {}),
      ...(query.search
        ? { employeeProfile: { user: { name: { contains: query.search, mode: "insensitive" as const } } } }
        : {}),
    };
  }

  private async loadEmployee(employeeProfileId: string): Promise<EmployeeWithRefs> {
    const employee = await this.prisma.client.employeeProfile.findUnique({
      where: { id: employeeProfileId },
      include: { user: { include: { role: true } }, primaryBranch: true },
    });
    if (!employee) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Employee not found" });
    }
    return employee;
  }

  private async loadRequestForTransition(tx: TxClient, id: string) {
    const request = await tx.leaveRequest.findUnique({ where: { id } });
    if (!request) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Leave request not found" });
    }
    this.assertBranchAccess(request.branchId);
    if (request.status !== "pending" && request.status !== "pending_second_approval") {
      throw new ConflictException({
        code: ERROR_CODES.LEAVE_REQUEST_NOT_PENDING,
        message: "This request has already been resolved",
      });
    }
    return request;
  }

  /** Writes `on_leave` for each date in range that has no recorded sessions — real activity always wins. */
  private async markAttendanceOnLeave(
    tx: TxClient,
    employeeProfileId: string,
    start: Date,
    end: Date,
  ): Promise<void> {
    for (const date of daysBetweenInclusive(start, end)) {
      const existing = await tx.attendanceDay.findUnique({
        where: { employeeProfileId_date: { employeeProfileId, date } },
        include: { sessions: { select: { id: true }, take: 1 } },
      });
      if (existing) {
        if (existing.sessions.length > 0) continue;
        await tx.attendanceDay.update({ where: { id: existing.id }, data: { status: "on_leave" } });
      } else {
        await tx.attendanceDay.create({ data: { employeeProfileId, date, status: "on_leave" } });
      }
    }
  }

  /**
   * Undoes `markAttendanceOnLeave` on cancel: deletes a day only if it's still `on_leave` with
   * zero sessions (untouched since approval) — if sessions exist, a later edit already overwrote
   * the status away from `on_leave`, so there's nothing left to revert. Deleting (not just
   * resetting a status) returns the day to the normal derive-on-read path every other Attendance
   * day without a stored row already uses.
   */
  private async revertAttendanceOnLeave(
    tx: TxClient,
    employeeProfileId: string,
    start: Date,
    end: Date,
  ): Promise<void> {
    for (const date of daysBetweenInclusive(start, end)) {
      const existing = await tx.attendanceDay.findUnique({
        where: { employeeProfileId_date: { employeeProfileId, date } },
        include: { sessions: { select: { id: true }, take: 1 } },
      });
      if (existing && existing.status === "on_leave" && existing.sessions.length === 0) {
        await tx.attendanceDay.delete({ where: { id: existing.id } });
      }
    }
  }

  /** Rejects a request that occupies the same half (or more) of a day as an existing active one. */
  private async assertNoDateConflict(tx: TxClient, employeeProfileId: string, input: HalfDayInput & { startDate: Date; endDate: Date }): Promise<void> {
    const candidates = await tx.leaveRequest.findMany({
      where: {
        employeeProfileId,
        status: { in: [...ACTIVE_LEAVE_STATUSES] },
        startDate: { lte: input.endDate },
        endDate: { gte: input.startDate },
      },
      select: { startDate: true, endDate: true, startHalfDay: true, endHalfDay: true, halfDayPeriod: true },
    });
    if (candidates.length === 0) return;

    const newPortions = dayPortions(input.startDate, input.endDate, input);
    for (const existing of candidates) {
      const existingPortions = dayPortions(existing.startDate, existing.endDate, {
        startHalfDay: existing.startHalfDay,
        endHalfDay: existing.endHalfDay,
        halfDayPeriod: existing.halfDayPeriod ?? undefined,
      });
      for (const [time, portion] of newPortions) {
        const existingPortion = existingPortions.get(time);
        if (existingPortion && portionsConflict(portion, existingPortion)) {
          throw new ConflictException({
            code: ERROR_CODES.LEAVE_DATE_CONFLICT,
            message: "A leave request already exists for one or more of these dates",
          });
        }
      }
    }
  }

  private async resolveOwnEmployeeProfile(userId: string): Promise<{ id: string }> {
    const profile = await this.prisma.client.employeeProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "No employee profile for current user" });
    }
    return profile;
  }

  private assertBranchAccess(branchId: string): void {
    const effective = getEffectiveBranchIds(this.cls);
    if (effective && !effective.includes(branchId)) {
      throw new ForbiddenException({ code: ERROR_CODES.BRANCH_ACCESS_DENIED, message: "Branch access denied" });
    }
  }

  private assertEmployeeBranchAccess(primaryBranchId: string | null): void {
    const effective = getEffectiveBranchIds(this.cls);
    if (effective && (!primaryBranchId || !effective.includes(primaryBranchId))) {
      throw new ForbiddenException({ code: ERROR_CODES.BRANCH_ACCESS_DENIED, message: "Branch access denied" });
    }
  }
}

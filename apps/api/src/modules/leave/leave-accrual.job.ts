import { Prisma, type LeaveCreditPolicy } from "@prisma/client";
import type { PrismaService, TxClient } from "../../database/prisma.service";
import { ensureYearBalance, round2 } from "./leave-balance.util";

export type LeaveTypeForAccrual = Prisma.LeaveTypeGetPayload<{
  select: { id: true; creditPolicy: true; daysPerYear: true; allowCarryForward: true; maxCarryForwardDays: true };
}>;

export function dateOnlyUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function sameMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

function lastDayOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

/**
 * Whether a credit is due today for this policy, given the last credit applied (`null` = never).
 * Checked relative to `lastAccruedAt` rather than an exact date match, so a missed day (worker
 * downtime) is caught up on the next run instead of silently skipped — and never double-credits
 * a period that's already been applied.
 */
function isAccrualDue(policy: LeaveCreditPolicy, lastAccruedAt: Date | null, today: Date, anniversaryThisYear: Date): boolean {
  switch (policy) {
    case "beginning_of_year":
      return !lastAccruedAt || lastAccruedAt.getUTCFullYear() !== today.getUTCFullYear();
    case "monthly":
    case "beginning_of_month":
      return !lastAccruedAt || !sameMonth(lastAccruedAt, today);
    case "end_of_month": {
      if (today.getTime() < lastDayOfMonth(today).getTime()) return false;
      return !lastAccruedAt || !sameMonth(lastAccruedAt, today);
    }
    case "anniversary":
      if (today.getTime() < anniversaryThisYear.getTime()) return false;
      return !lastAccruedAt || lastAccruedAt.getUTCFullYear() !== today.getUTCFullYear();
  }
}

/**
 * Credits ONE employee's ONE leave-type balance if due, given today's date — the per-row
 * body shared by the nightly job below and `LeaveTypesService.create()` (which calls this once,
 * eagerly, for every currently-eligible employee right when a leave type is created, so a
 * new type doesn't sit at `accrued: 0` until the next nightly run).
 */
export async function accrueIfDue(
  tx: TxClient,
  params: {
    employeeProfileId: string;
    joiningDate: Date | null;
    leaveType: LeaveTypeForAccrual;
    today: Date;
  },
): Promise<void> {
  const { employeeProfileId, joiningDate, leaveType, today } = params;
  const year = today.getUTCFullYear();
  const balance = await ensureYearBalance(tx, {
    employeeProfileId,
    leaveTypeId: leaveType.id,
    year,
    allowCarryForward: leaveType.allowCarryForward,
    maxCarryForwardDays: leaveType.maxCarryForwardDays,
  });

  const anniversaryThisYear = joiningDate
    ? new Date(Date.UTC(year, joiningDate.getUTCMonth(), joiningDate.getUTCDate()))
    : new Date(Date.UTC(year, 0, 1));
  if (!isAccrualDue(leaveType.creditPolicy, balance.lastAccruedAt, today, anniversaryThisYear)) return;

  const isYearlyGrain = leaveType.creditPolicy === "beginning_of_year" || leaveType.creditPolicy === "anniversary";
  const amount = isYearlyGrain ? Number(leaveType.daysPerYear) : round2(Number(leaveType.daysPerYear) / 12);

  await tx.leaveBalance.update({
    where: { id: balance.id },
    data: { accrued: { increment: amount }, lastAccruedAt: today },
  });
}

/**
 * Daily scheduled job (worker.ts's "scheduled" queue) crediting every active employee's
 * leave balance per their leave type's credit policy. Exported as a plain function so it's
 * callable directly from integration tests without going through BullMQ.
 */
export async function runLeaveAccrualJob(prisma: PrismaService): Promise<void> {
  const today = dateOnlyUtc(new Date());
  const leaveTypes = await prisma.client.leaveType.findMany({ where: { isActive: true } });
  if (leaveTypes.length === 0) return;

  // A null joiningDate means "always eligible" everywhere else in this codebase (see
  // money.ts's paidDaysForJoin) — `{ lte: today }` alone would exclude those rows, since SQL
  // NULL <= today is never true.
  const employees = await prisma.client.employeeProfile.findMany({
    where: {
      OR: [{ joiningDate: null }, { joiningDate: { lte: today } }],
      user: { status: "active", deletedAt: null },
    },
    select: { id: true, joiningDate: true },
  });
  if (employees.length === 0) return;

  for (const type of leaveTypes) {
    for (const member of employees) {
      await prisma.client.$transaction((tx) =>
        accrueIfDue(tx, {
          employeeProfileId: member.id,
          joiningDate: member.joiningDate,
          leaveType: type,
          today,
        }),
      );
    }
  }
}

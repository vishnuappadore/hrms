import { Prisma, type LeaveCreditPolicy } from "@prisma/client";
import type { AuthPrismaService } from "../../database/auth-prisma.service";
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
 * Credits ONE staff member's ONE leave-type balance if due, given today's date — the per-row
 * body shared by the nightly job below and `LeaveTypesService.create()` (which calls this once,
 * eagerly, for every currently-eligible staff member right when a leave type is created, so a
 * new type doesn't sit at `accrued: 0` until the next nightly run).
 */
export async function accrueIfDue(
  tx: TxClient,
  params: {
    tenantId: string;
    staffProfileId: string;
    joiningDate: Date | null;
    leaveType: LeaveTypeForAccrual;
    today: Date;
  },
): Promise<void> {
  const { tenantId, staffProfileId, joiningDate, leaveType, today } = params;
  const year = today.getUTCFullYear();
  const balance = await ensureYearBalance(tx, {
    tenantId,
    staffProfileId,
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
 * Daily scheduled job (worker.ts's "scheduled" queue) crediting every active staff member's
 * leave balance per their leave type's credit policy. Exported as a plain function so it's
 * callable directly from integration tests without going through BullMQ.
 */
export async function runLeaveAccrualJob(prisma: PrismaService, authPrisma: AuthPrismaService): Promise<void> {
  const today = dateOnlyUtc(new Date());
  const tenants = await authPrisma.tenant.findMany({ where: { status: "active" }, select: { id: true } });

  for (const tenant of tenants) {
    await prisma.runWithTenant(tenant.id, async () => {
      const leaveTypes = await prisma.client.leaveType.findMany({ where: { isActive: true } });
      if (leaveTypes.length === 0) return;

      // A null joiningDate means "always eligible" everywhere else in this codebase (see
      // money.ts's paidDaysForJoin) — `{ lte: today }` alone would exclude those rows, since SQL
      // NULL <= today is never true.
      const staff = await prisma.client.staffProfile.findMany({
        where: {
          OR: [{ joiningDate: null }, { joiningDate: { lte: today } }],
          user: { status: "active", deletedAt: null },
        },
        select: { id: true, joiningDate: true },
      });
      if (staff.length === 0) return;

      for (const type of leaveTypes) {
        for (const member of staff) {
          await prisma.withTenantTx((tx) =>
            accrueIfDue(tx, {
              tenantId: tenant.id,
              staffProfileId: member.id,
              joiningDate: member.joiningDate,
              leaveType: type,
              today,
            }),
          );
        }
      }
    });
  }
}

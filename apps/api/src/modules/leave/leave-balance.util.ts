import { Prisma } from "@prisma/client";
import type { TxClient } from "../../database/prisma.service";

export type LeaveBalanceRow = Prisma.LeaveBalanceGetPayload<Record<string, never>>;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** opening + accrued + carriedForward - used — computed on read, never stored. */
export function closingBalance(row: LeaveBalanceRow): number {
  return round2(Number(row.openingBalance) + Number(row.accrued) + Number(row.carriedForward) - Number(row.used));
}

/**
 * Get-or-create this year's balance row for an employee + leave type. Creating it is also
 * where year-rollover + carry-forward happens (once per employee+type+year, from the prior year's
 * closing balance, capped at maxCarryForwardDays) — independent of the leave type's credit
 * policy, which only governs how `accrued` grows afterward (see leave-accrual.job.ts).
 */
export async function ensureYearBalance(
  tx: TxClient,
  params: {
    employeeProfileId: string;
    leaveTypeId: string;
    year: number;
    allowCarryForward: boolean;
    maxCarryForwardDays: number;
  },
): Promise<LeaveBalanceRow> {
  const { employeeProfileId, leaveTypeId, year, allowCarryForward, maxCarryForwardDays } = params;
  const existing = await tx.leaveBalance.findUnique({
    where: { employeeProfileId_leaveTypeId_year: { employeeProfileId, leaveTypeId, year } },
  });
  if (existing) return existing;

  let carriedForward = 0;
  if (allowCarryForward) {
    const prior = await tx.leaveBalance.findUnique({
      where: {
        employeeProfileId_leaveTypeId_year: { employeeProfileId, leaveTypeId, year: year - 1 },
      },
    });
    if (prior) {
      carriedForward = Math.max(0, Math.min(closingBalance(prior), maxCarryForwardDays));
    }
  }

  return tx.leaveBalance.create({
    data: { employeeProfileId, leaveTypeId, year, openingBalance: 0, accrued: 0, used: 0, carriedForward },
  });
}

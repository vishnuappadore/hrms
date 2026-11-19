import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Prisma } from "@prisma/client";
import {
  assertMinorUnits,
  ERROR_CODES,
  paidDaysForJoin,
  PAYROLL_ITEM_TRANSITIONS,
  PAYROLL_TAB_STATUSES,
  payrollMonthBounds,
  prorateAmount,
  resolveComponentAmountMinor,
  type BulkPayrollActionInput,
  type EditPayrollItemInput,
  type GeneratePayrollRunInput,
  type GetPayrollRunQuery,
  type ListPayrollBatchItemsQuery,
  type ListPayrollItemsQuery,
  type Paginated,
  type PayrollAdjustmentType,
  type PayrollBatch,
  type PayrollItemDetail,
  type PayrollItemStatus,
  type PayrollItemSummary,
  type PayrollMonthBounds,
  type PayrollRun as PayrollRunResponse,
  type PayrollRunPreview,
  type PayrollTab,
} from "@keystonehr/shared";
import { CLS_KEYS, getEffectiveBranchIds } from "../../common/request-context";
import { PrismaService, type TxClient } from "../../database/prisma.service";
import { AttendanceService } from "../attendance/attendance.service";
import { AuditService } from "../audit/audit.service";
import { LeaveService } from "../leave/leave.service";

/** Shared select — every listing row and the payslip detail both need this shape. */
const ITEM_INCLUDE = {
  user: {
    select: {
      id: true,
      name: true,
      role: { select: { nameEn: true } },
      employeeProfile: { select: { joiningDate: true } },
    },
  },
  batch: { select: { batchNo: true } },
  adjustments: true,
  payrollRun: { select: { payrollMonth: true, branch: { select: { nameEn: true, nameAr: true } } } },
} satisfies Prisma.PayrollItemInclude;

type ItemRow = Prisma.PayrollItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

const DETAIL_INCLUDE = {
  ...ITEM_INCLUDE,
  components: true,
  payrollRun: {
    select: { branchId: true, payrollMonth: true, branch: { select: { nameEn: true, nameAr: true } } },
  },
} satisfies Prisma.PayrollItemInclude;

type ItemDetailRow = Prisma.PayrollItemGetPayload<{ include: typeof DETAIL_INCLUDE }>;

/** Shared by generation and sync — everything needed to snapshot one employee's payroll item. */
const ELIGIBLE_EMPLOYEE_SELECT = {
  id: true,
  employeeProfile: {
    select: {
      id: true,
      baseSalaryMinor: true,
      joiningDate: true,
      payrollComponents: {
        select: {
          amountMinor: true,
          payrollComponent: {
            select: { category: true, nameEn: true, nameAr: true, basis: true, defaultRatePct: true },
          },
        },
      },
    },
  },
} satisfies Prisma.UserSelect;

type EligibleEmployeeRow = Prisma.UserGetPayload<{ select: typeof ELIGIBLE_EMPLOYEE_SELECT }>;
type EligibleEmployeeProfile = NonNullable<EligibleEmployeeRow["employeeProfile"]>;

type BulkAction = "approve" | "reject" | "mark-paid" | "revert";

/** Target status reached by each action — validated against PAYROLL_ITEM_TRANSITIONS. */
const ACTION_TARGET: Record<BulkAction, PayrollItemStatus> = {
  approve: "approved",
  reject: "rejected",
  "mark-paid": "paid",
  revert: "pending",
};

/**
 * Resolves "select all" to the statuses a bulk action should actually touch
 * for a given tab — the intersection of what that tab displays
 * (PAYROLL_TAB_STATUSES) with what's a valid source for the action
 * (PAYROLL_ITEM_TRANSITIONS). Necessary because the Approved tab displays
 * both `approved` AND `paid` items (paid has no separate tab) — without this
 * intersection, a "select all" bulk Mark Paid/Revert from the Approved tab
 * would sweep in already-`paid` (terminal) rows and fail applyAction's
 * per-item transition check for the whole batch.
 */
function sourceStatusesForTab(tab: PayrollTab, action: BulkAction): PayrollItemStatus[] {
  const target = ACTION_TARGET[action];
  return PAYROLL_TAB_STATUSES[tab].filter((s) => PAYROLL_ITEM_TRANSITIONS[s].includes(target));
}

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
    private readonly attendance: AttendanceService,
    private readonly leave: LeaveService,
  ) {}

  /* ── Runs ──────────────────────────────────────────────────────────────── */

  async getRun(query: GetPayrollRunQuery): Promise<PayrollRunResponse | null> {
    this.assertBranchAccess(query.branchId);
    const run = await this.prisma.client.payrollRun.findUnique({
      where: {
        branchId_payrollMonth: {
          branchId: query.branchId,
          payrollMonth: monthStringToDate(query.payrollMonth),
        },
      },
    });
    return run ? toRunResponse(run) : null;
  }

  /**
   * Lets the web app show a confirm dialog with real counts before calling
   * `generateRun` — read-only, no writes, no audit log (same as `getRun`/
   * `listItems`). `existingEmployeeCount` reflects what's actually already in
   * the run (never a live recount), so `totalEmployeeCount` can't undercount
   * relative to reality — see the schema doc comment for why.
   */
  async previewRun(query: GetPayrollRunQuery): Promise<PayrollRunPreview> {
    this.assertBranchAccess(query.branchId);
    const payrollMonth = monthStringToDate(query.payrollMonth);
    const bounds = payrollMonthBounds(query.payrollMonth);

    const run = await this.prisma.client.payrollRun.findUnique({
      where: { branchId_payrollMonth: { branchId: query.branchId, payrollMonth } },
    });

    const existingUserIds = run
      ? (
          await this.prisma.client.payrollItem.findMany({
            where: { payrollRunId: run.id },
            select: { userId: true },
          })
        ).map((i) => i.userId)
      : [];

    const newEmployeeCount = await this.prisma.client.user.count({
      where: {
        status: "active",
        deletedAt: null,
        employeeProfile: {
          primaryBranchId: query.branchId,
          OR: [{ joiningDate: null }, { joiningDate: { lte: bounds.end } }],
        },
        id: { notIn: existingUserIds },
      },
    });

    const statusCounts = { pending: 0, approved: 0, rejected: 0, paid: 0 };
    if (run) {
      const groups = await this.prisma.client.payrollItem.groupBy({
        by: ["status"],
        where: { payrollRunId: run.id },
        _count: { _all: true },
      });
      for (const g of groups) statusCounts[g.status] = g._count._all;
    }

    const existingEmployeeCount = existingUserIds.length;
    return {
      runExists: run !== null,
      existingEmployeeCount,
      newEmployeeCount,
      totalEmployeeCount: existingEmployeeCount + newEmployeeCount,
      statusCounts,
    };
  }

  /**
   * First call for a (branch, month): generates the run + one payroll_item
   * per eligible employee. A later call for the SAME (branch, month)
   * doesn't recreate the run — it runs an additive sync pass instead,
   * adding items only for employees who became newly eligible since generation
   * (e.g. a branch reassignment after the fact). Existing items are never
   * touched, recomputed, or removed — see docs/MODULES/payroll.md
   * "Regeneration". Both paths share `createItemForEmployee` for the per-employee
   * snapshot logic.
   */
  async generateRun(input: GeneratePayrollRunInput): Promise<PayrollRunResponse> {
    this.assertBranchAccess(input.branchId);
    const userId = this.cls.get(CLS_KEYS.userId) as string;
    const payrollMonth = monthStringToDate(input.payrollMonth);
    const bounds = payrollMonthBounds(input.payrollMonth);

    const existing = await this.prisma.client.payrollRun.findUnique({
      where: { branchId_payrollMonth: { branchId: input.branchId, payrollMonth } },
    });
    if (existing) {
      await this.syncNewEmployeesIntoRun(existing.id, input.branchId, existing.currency, bounds);
      return toRunResponse(existing);
    }

    const employees = await this.prisma.client.user.findMany({
      where: {
        status: "active",
        deletedAt: null,
        employeeProfile: {
          primaryBranchId: input.branchId,
          OR: [{ joiningDate: null }, { joiningDate: { lte: bounds.end } }],
        },
      },
      select: ELIGIBLE_EMPLOYEE_SELECT,
    });
    if (employees.length === 0) {
      throw new ConflictException({
        code: ERROR_CODES.PAYROLL_NO_ELIGIBLE_EMPLOYEES,
        message: "No eligible employees found for this branch and month",
      });
    }

    return this.prisma.client.$transaction(async (tx) => {
      const branch = await tx.branch.findFirstOrThrow({ where: { id: input.branchId } });

      const run = await tx.payrollRun.create({
        data: { branchId: input.branchId, payrollMonth, currency: branch.currency, generatedBy: userId },
      });

      for (const e of employees) {
        if (!e.employeeProfile) continue;
        await this.createItemForEmployee(tx, run.id, branch.currency, e.id, e.employeeProfile, bounds);
      }

      await this.audit.log(
        {
          action: "payroll_run.generated",
          entityType: "payroll_run",
          entityId: run.id,
          after: { branchId: input.branchId, payrollMonth: input.payrollMonth, employeeCount: employees.length },
        },
        tx,
      );

      return toRunResponse(run);
    });
  }

  /**
   * Additive sync for an already-generated run: adds payroll_items for employees
   * newly eligible for this branch since generation. One transaction PER
   * employee (not one shared transaction for the batch) — Postgres
   * aborts an entire transaction on its first error, so a shared transaction
   * would let one concurrent-sync race (P2002 on the unique
   * (payrollRunId, userId) pair) wipe out unrelated employees in the same pass.
   * Per-employee transactions mean that race only affects the one colliding row.
   */
  private async syncNewEmployeesIntoRun(
    runId: string,
    branchId: string,
    currency: string,
    bounds: PayrollMonthBounds,
  ): Promise<void> {
    const existingUserIds = (
      await this.prisma.client.payrollItem.findMany({
        where: { payrollRunId: runId },
        select: { userId: true },
      })
    ).map((i) => i.userId);

    const employees = await this.prisma.client.user.findMany({
      where: {
        status: "active",
        deletedAt: null,
        employeeProfile: {
          primaryBranchId: branchId,
          OR: [{ joiningDate: null }, { joiningDate: { lte: bounds.end } }],
        },
        id: { notIn: existingUserIds },
      },
      select: ELIGIBLE_EMPLOYEE_SELECT,
    });

    let addedCount = 0;
    for (const e of employees) {
      if (!e.employeeProfile) continue;
      try {
        await this.prisma.client.$transaction((tx) =>
          this.createItemForEmployee(tx, runId, currency, e.id, e.employeeProfile!, bounds),
        );
        addedCount++;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
        throw err;
      }
    }

    if (addedCount > 0) {
      await this.audit.log({
        action: "payroll_run.synced",
        entityType: "payroll_run",
        entityId: runId,
        after: { branchId, addedCount },
      });
    }
  }

  /**
   * Proration + deduction math shared by `createItemForEmployee` (new item) and `recomputeItem`
   * (refresh an existing Pending item from current data). Base salary, allowances, and statutory
   * deductions are all prorated by `paidDays`/totalDays for a mid-month joiner
   * (docs/MODULES/payroll.md) — each component line is prorated INDIVIDUALLY, then summed, so the
   * persisted breakdown always sums exactly to the totals (rather than prorating a pre-summed
   * total, which can round differently). `paidDays` is purely Date-of-Join based — it is NOT
   * reduced by unpaid leave, so Base Salary/Allowances/Statutory stay whole except for an actual
   * mid-month joiner.
   *
   * Absence Deduction and Leave Deduction (unpaid leave) are both separate lines, each a per-day
   * rate × a day count (AttendanceService.countAbsentDays / LeaveService.getUnpaidLeaveDays) on
   * the SAME basis: Gross = full, unprorated base salary + full, unprorated allowance components
   * — independent of join-date proration (a day's absence/unpaid-leave is worth a full day's rate
   * regardless of how many days that month were actually worked). A day covered by any approved
   * leave (paid or unpaid) gets the `on_leave` AttendanceDay status, never `absent`, so these two
   * never double-count the same calendar day.
   *
   * Returns `null` when the employee isn't eligible for this month at all (joined after it
   * ends) — callers skip/no-op in that case.
   */
  private async computeFigures(
    profile: EligibleEmployeeProfile,
    bounds: PayrollMonthBounds,
  ): Promise<{
    paidDays: number;
    baseSalaryMinor: bigint;
    allowancesTotal: bigint;
    deductionsTotal: bigint;
    absentDays: number;
    absenceDeductionMinor: bigint;
    unpaidLeaveDays: number;
    leaveDeductionMinor: bigint;
    components: { category: "allowance" | "deduction"; nameEn: string; nameAr: string; amountMinor: bigint }[];
  } | null> {
    const paidDays = paidDaysForJoin(bounds, profile.joiningDate);
    if (paidDays == null) return null;

    const rangeStart = profile.joiningDate && profile.joiningDate.getTime() > bounds.start.getTime()
      ? profile.joiningDate
      : bounds.start;
    const [unpaidLeaveDays, absentDays] = await Promise.all([
      this.leave.getUnpaidLeaveDays(profile.id, bounds.start, bounds.end),
      this.attendance.countAbsentDays(profile.id, rangeStart, bounds.end),
    ]);

    const prorate = (amountMinor: bigint) => BigInt(prorateAmount(Number(amountMinor), paidDays, bounds.totalDays));

    // Percentage-basis components (e.g. "ESI 12%") are never trusted from the stored
    // `amountMinor` snapshot (a one-time client-side convenience, employees' employee-form.tsx —
    // stale the moment base salary changes) — recomputed live from the CURRENT base salary every
    // time, same as Absence/Leave Deduction. Fixed-amount components use the stored value as before.
    const resolveAmount = (c: EligibleEmployeeProfile["payrollComponents"][number]) =>
      BigInt(
        resolveComponentAmountMinor(
          {
            basis: c.payrollComponent.basis,
            defaultRatePct:
              c.payrollComponent.defaultRatePct != null ? Number(c.payrollComponent.defaultRatePct) : null,
          },
          Number(profile.baseSalaryMinor),
          Number(c.amountMinor),
        ),
      );

    const allowances = profile.payrollComponents
      .filter((c) => c.payrollComponent.category === "allowance")
      .map((c) => ({ ...c.payrollComponent, amountMinor: prorate(resolveAmount(c)) }));
    const deductions = profile.payrollComponents
      .filter((c) => c.payrollComponent.category === "deduction")
      .map((c) => ({ ...c.payrollComponent, amountMinor: prorate(resolveAmount(c)) }));

    const fullAllowancesTotal = sumBigint(
      profile.payrollComponents
        .filter((c) => c.payrollComponent.category === "allowance")
        .map(resolveAmount),
    );
    const grossMinor = Number(profile.baseSalaryMinor + fullAllowancesTotal);

    return {
      paidDays,
      baseSalaryMinor: prorate(profile.baseSalaryMinor),
      allowancesTotal: sumBigint(allowances.map((c) => c.amountMinor)),
      deductionsTotal: sumBigint(deductions.map((c) => c.amountMinor)),
      absentDays,
      absenceDeductionMinor: BigInt(prorateAmount(grossMinor, absentDays, bounds.totalDays)),
      unpaidLeaveDays,
      leaveDeductionMinor: BigInt(prorateAmount(grossMinor, unpaidLeaveDays, bounds.totalDays)),
      components: [...allowances, ...deductions],
    };
  }

  /**
   * Snapshots one employee's salary/components into a new payroll_item. Shared by generate +
   * sync. Employees who haven't joined by the end of this month are excluded upstream (the
   * eligibility `where` clauses), so `computeFigures` returning `null` here is defensive, not
   * expected.
   */
  private async createItemForEmployee(
    tx: TxClient,
    runId: string,
    currency: string,
    employeeUserId: string,
    profile: EligibleEmployeeProfile,
    bounds: PayrollMonthBounds,
  ): Promise<void> {
    const figures = await this.computeFigures(profile, bounds);
    if (!figures) return;

    const netPayMinor =
      figures.baseSalaryMinor +
      figures.allowancesTotal -
      figures.deductionsTotal -
      figures.absenceDeductionMinor -
      figures.leaveDeductionMinor;
    assertMinorUnits(Number(netPayMinor));

    await tx.payrollItem.create({
      data: {
        payrollRunId: runId,
        userId: employeeUserId,
        employeeProfileId: profile.id,
        currency,
        baseSalaryMinor: figures.baseSalaryMinor,
        allowancesTotalMinor: figures.allowancesTotal,
        statutoryDeductionsTotalMinor: figures.deductionsTotal,
        otherDeductionMinor: 0n,
        absenceDeductionMinor: figures.absenceDeductionMinor,
        absentDays: figures.absentDays,
        leaveDeductionMinor: figures.leaveDeductionMinor,
        unpaidLeaveDays: figures.unpaidLeaveDays,
        netPayMinor,
        paidDays: figures.paidDays,
        components: {
          create: figures.components.map((c) => ({
            category: c.category,
            nameEn: c.nameEn,
            nameAr: c.nameAr,
            amountMinor: c.amountMinor,
          })),
        },
      },
    });
  }

  /* ── Listing ───────────────────────────────────────────────────────────── */

  async listItems(runId: string, query: ListPayrollItemsQuery): Promise<Paginated<PayrollItemSummary>> {
    await this.getRunOrThrow(runId);
    const where = { payrollRunId: runId, status: { in: [...PAYROLL_TAB_STATUSES[query.tab]] } };
    const [total, items] = await Promise.all([
      this.prisma.client.payrollItem.count({ where }),
      this.prisma.client.payrollItem.findMany({
        where,
        include: ITEM_INCLUDE,
        orderBy: { user: { name: "asc" } },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { data: items.map(toItemSummary), meta: { page: query.page, pageSize: query.pageSize, total } };
  }

  /** Lightweight batch menu — metadata + aggregates only, no nested items (see listBatchItems). */
  async listBatches(runId: string, tab: "approved" | "rejected"): Promise<PayrollBatch[]> {
    await this.getRunOrThrow(runId);
    const action = tab === "approved" ? "approve" : "reject";
    const batches = await this.prisma.client.payrollActionBatch.findMany({
      where: { payrollRunId: runId, action },
      orderBy: { batchNo: "desc" },
    });
    const sums = await this.prisma.client.payrollItem.groupBy({
      by: ["batchId"],
      where: { batchId: { in: batches.map((b) => b.id) } },
      _count: { _all: true },
      _sum: { netPayMinor: true },
    });
    const sumsByBatch = new Map(sums.map((s) => [s.batchId, s]));
    return batches.map((b) => ({
      id: b.id,
      batchNo: b.batchNo,
      action: b.action,
      performedBy: b.performedBy,
      performedAt: b.performedAt,
      count: sumsByBatch.get(b.id)?._count._all ?? 0,
      totalNetMinor: Number(sumsByBatch.get(b.id)?._sum.netPayMinor ?? 0n),
    }));
  }

  /** Paginated items for a single batch — powers the right-hand pane of the Batch view's sidebar. */
  async listBatchItems(
    runId: string,
    batchId: string,
    query: ListPayrollBatchItemsQuery,
  ): Promise<Paginated<PayrollItemSummary>> {
    await this.getRunOrThrow(runId);
    const batch = await this.prisma.client.payrollActionBatch.findFirst({ where: { id: batchId, payrollRunId: runId } });
    if (!batch) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Payroll batch not found" });

    const where = { batchId };
    const [total, items] = await Promise.all([
      this.prisma.client.payrollItem.count({ where }),
      this.prisma.client.payrollItem.findMany({
        where,
        include: ITEM_INCLUDE,
        orderBy: { user: { name: "asc" } },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { data: items.map(toItemSummary), meta: { page: query.page, pageSize: query.pageSize, total } };
  }

  /* ── Payslip detail + edit ─────────────────────────────────────────────── */

  async getItemDetail(itemId: string): Promise<PayrollItemDetail> {
    const item = await this.findItemOrThrow(itemId);
    return toItemDetail(item);
  }

  /** Deductions/allowances-override/ad-hoc rows are editable while Pending or Approved (pre-payment). */
  async editItem(itemId: string, input: EditPayrollItemInput): Promise<PayrollItemDetail> {
    const item = await this.findItemOrThrow(itemId);
    if (item.status === "paid" || item.status === "rejected") {
      throw new ConflictException({
        code: ERROR_CODES.PAYROLL_ITEM_LOCKED,
        message: "Payroll item cannot be edited in its current status",
      });
    }

    await this.prisma.client.$transaction(async (tx) => {
      const data: Prisma.PayrollItemUpdateInput = {};
      if (input.allowancesTotalMinor != null) {
        data.allowancesTotalMinor = BigInt(input.allowancesTotalMinor);
      }
      if (input.statutoryDeductionsTotalMinor != null) {
        data.statutoryDeductionsTotalMinor = BigInt(input.statutoryDeductionsTotalMinor);
      }
      if (input.otherDeductionMinor != null) {
        data.otherDeductionMinor = BigInt(input.otherDeductionMinor);
      }
      if (input.absenceDeductionMinor != null) {
        data.absenceDeductionMinor = BigInt(input.absenceDeductionMinor);
      }
      if (input.leaveDeductionMinor != null) {
        data.leaveDeductionMinor = BigInt(input.leaveDeductionMinor);
      }
      if (input.additions) {
        await this.replaceAdjustments(tx, itemId, "addition", input.additions);
      }
      if (input.extraDeductions) {
        await this.replaceAdjustments(tx, itemId, "deduction", input.extraDeductions);
      }
      if (Object.keys(data).length > 0) {
        await tx.payrollItem.update({ where: { id: itemId }, data });
      }

      const netPayMinor = await this.recomputeNetPay(tx, itemId);

      await this.audit.log(
        {
          action: "payroll_item.edited",
          entityType: "payroll_item",
          entityId: itemId,
          after: { netPayMinor: Number(netPayMinor) },
        },
        tx,
      );
    });

    return this.getItemDetail(itemId);
  }

  /**
   * Recomputes the SYSTEM-COMPUTED figures (paidDays, base salary, allowances/statutory
   * breakdown+totals, Absence Deduction, Leave Deduction) for a still-Pending item from CURRENT
   * employee profile/leave/attendance data — the same formula `createItemForEmployee` uses at
   * generation time, just updating the existing row instead of inserting one. Manual-only fields
   * (`otherDeductionMinor`, ad-hoc additions/extraDeductions) are left untouched — those are
   * orthogonal admin overrides, not part of this formula.
   *
   * Needed because an already-generated item is otherwise a frozen snapshot
   * (docs/MODULES/payroll.md "Regeneration") — e.g. unpaid leave approved after generation has no
   * way to reach an existing item, since `EditPayrollItemSchema` has no `paidDays`/base-salary
   * field to hand-edit it with.
   */
  async recomputeItem(itemId: string): Promise<PayrollItemDetail> {
    const item = await this.findItemOrThrow(itemId);
    if (item.status !== "pending") {
      throw new ConflictException({
        code: ERROR_CODES.PAYROLL_ITEM_LOCKED,
        message: "Only a Pending payroll item can be recomputed",
      });
    }

    const employeeRow = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: item.userId },
      select: ELIGIBLE_EMPLOYEE_SELECT,
    });
    if (!employeeRow.employeeProfile) return this.getItemDetail(itemId);

    const bounds = payrollMonthBounds(dateToMonthString(item.payrollRun.payrollMonth));
    const figures = await this.computeFigures(employeeRow.employeeProfile, bounds);
    // No longer eligible for this month (e.g. Date of Join edited past month-end) — leave the
    // existing item frozen as-is, same "never removed retroactively" rule as docs/MODULES/payroll.md §10.
    if (!figures) return this.getItemDetail(itemId);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.payrollItem.update({
        where: { id: itemId },
        data: {
          baseSalaryMinor: figures.baseSalaryMinor,
          allowancesTotalMinor: figures.allowancesTotal,
          statutoryDeductionsTotalMinor: figures.deductionsTotal,
          absenceDeductionMinor: figures.absenceDeductionMinor,
          absentDays: figures.absentDays,
          leaveDeductionMinor: figures.leaveDeductionMinor,
          unpaidLeaveDays: figures.unpaidLeaveDays,
          paidDays: figures.paidDays,
          components: {
            deleteMany: {},
            create: figures.components.map((c) => ({
              category: c.category,
              nameEn: c.nameEn,
              nameAr: c.nameAr,
              amountMinor: c.amountMinor,
            })),
          },
        },
      });

      const netPayMinor = await this.recomputeNetPay(tx, itemId);

      await this.audit.log(
        {
          action: "payroll_item.recomputed",
          entityType: "payroll_item",
          entityId: itemId,
          after: { paidDays: figures.paidDays, netPayMinor: Number(netPayMinor) },
        },
        tx,
      );
    });

    return this.getItemDetail(itemId);
  }

  /** Shared Net Pay formula + persistence — used by both `editItem` and `recomputeItem`. */
  private async recomputeNetPay(tx: TxClient, itemId: string): Promise<bigint> {
    const current = await tx.payrollItem.findUniqueOrThrow({ where: { id: itemId } });
    const adjustments = await tx.payrollItemAdjustment.findMany({ where: { payrollItemId: itemId } });
    const netPayMinor =
      current.baseSalaryMinor +
      current.allowancesTotalMinor +
      sumAdjustments(adjustments, "addition") -
      current.statutoryDeductionsTotalMinor -
      current.otherDeductionMinor -
      current.absenceDeductionMinor -
      current.leaveDeductionMinor -
      sumAdjustments(adjustments, "deduction");
    assertMinorUnits(Number(netPayMinor));
    await tx.payrollItem.update({ where: { id: itemId }, data: { netPayMinor } });
    return netPayMinor;
  }

  private async replaceAdjustments(
    tx: TxClient,
    itemId: string,
    type: PayrollAdjustmentType,
    rows: { labelEn: string; labelAr?: string | null; amountMinor: number }[],
  ): Promise<void> {
    await tx.payrollItemAdjustment.deleteMany({ where: { payrollItemId: itemId, type } });
    if (rows.length === 0) return;
    await tx.payrollItemAdjustment.createMany({
      data: rows.map((r) => ({
        payrollItemId: itemId,
        type,
        labelEn: r.labelEn,
        labelAr: r.labelAr ?? null,
        amountMinor: BigInt(r.amountMinor),
      })),
    });
  }

  /* ── Actions ───────────────────────────────────────────────────────────── */

  async approveItem(itemId: string): Promise<PayrollItemDetail> {
    await this.applyAction([itemId], "approve");
    return this.getItemDetail(itemId);
  }

  async rejectItem(itemId: string, reason?: string): Promise<PayrollItemDetail> {
    await this.applyAction([itemId], "reject", reason);
    return this.getItemDetail(itemId);
  }

  async markPaidItem(itemId: string): Promise<PayrollItemDetail> {
    await this.applyAction([itemId], "mark-paid");
    return this.getItemDetail(itemId);
  }

  async revertItem(itemId: string): Promise<PayrollItemDetail> {
    await this.applyAction([itemId], "revert");
    return this.getItemDetail(itemId);
  }

  async bulkApprove(runId: string, input: BulkPayrollActionInput): Promise<void> {
    await this.getRunOrThrow(runId);
    const itemIds = await this.resolveBulkItemIds(runId, "approve", input);
    if (itemIds.length === 0) return;
    await this.applyAction(itemIds, "approve", undefined, runId);
  }

  async bulkReject(runId: string, input: BulkPayrollActionInput): Promise<void> {
    await this.getRunOrThrow(runId);
    const itemIds = await this.resolveBulkItemIds(runId, "reject", input);
    if (itemIds.length === 0) return;
    await this.applyAction(itemIds, "reject", input.reason, runId);
  }

  async bulkMarkPaid(runId: string, input: BulkPayrollActionInput): Promise<void> {
    await this.getRunOrThrow(runId);
    const itemIds = await this.resolveBulkItemIds(runId, "mark-paid", input);
    if (itemIds.length === 0) return;
    await this.applyAction(itemIds, "mark-paid", undefined, runId);
  }

  async bulkRevert(runId: string, input: BulkPayrollActionInput): Promise<void> {
    await this.getRunOrThrow(runId);
    const itemIds = await this.resolveBulkItemIds(runId, "revert", input);
    if (itemIds.length === 0) return;
    await this.applyAction(itemIds, "revert", undefined, runId);
  }

  /**
   * Recomputes every selected (or all-matching) Pending item in one run. Recompute isn't a status
   * transition — the item stays `pending` throughout — so this doesn't go through
   * `resolveBulkItemIds`/`sourceStatusesForTab` (those are transition-specific); `selectAll` here
   * always means "every Pending item in this run" since the Pending tab never shows any other
   * status. Each item recomputes in its own call/transaction (not one shared transaction — the
   * per-employee leave/attendance lookups can't be batched into a single UPDATE). If one item raced
   * to a non-Pending status between selection and execution, `recomputeItem` throws
   * `PAYROLL_ITEM_LOCKED` for just that item — skip it and keep going rather than aborting the
   * whole batch over one stale row.
   */
  async bulkRecompute(runId: string, input: BulkPayrollActionInput): Promise<void> {
    await this.getRunOrThrow(runId);
    const itemIds =
      input.itemIds ??
      (
        await this.prisma.client.payrollItem.findMany({
          where: { payrollRunId: runId, status: "pending", id: { notIn: input.selectAll!.excludeIds } },
          select: { id: true },
        })
      ).map((r) => r.id);

    for (const itemId of itemIds) {
      try {
        await this.recomputeItem(itemId);
      } catch (err) {
        if (err instanceof ConflictException) continue;
        throw err;
      }
    }
  }

  /**
   * Resolves a bulk action's target ids. `itemIds` is the plain page-scoped
   * path (unchanged). `selectAll` is resolved fresh at execution time —
   * never a stale client-held snapshot — scoped to the run, the tab's valid
   * source statuses for this action (see sourceStatusesForTab), optionally
   * one batch, and minus any explicitly excluded ids.
   */
  private async resolveBulkItemIds(
    runId: string,
    action: BulkAction,
    input: BulkPayrollActionInput,
  ): Promise<string[]> {
    if (input.itemIds) return input.itemIds;
    const { tab, batchId, excludeIds } = input.selectAll!;
    const rows = await this.prisma.client.payrollItem.findMany({
      where: {
        payrollRunId: runId,
        status: { in: sourceStatusesForTab(tab, action) },
        ...(batchId ? { batchId } : {}),
        id: { notIn: excludeIds },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Every approve/reject action (single row or bulk) creates one
   * PayrollActionBatch row — this is what powers the Batch view. Mark-paid
   * and revert don't batch (mark-paid has no Finance integration yet either:
   * `finance_transactions` doesn't exist in the schema — Finance module is
   * unbuilt — so payroll can't write to it; revisit once it ships).
   */
  private async applyAction(
    itemIds: string[],
    action: BulkAction,
    reason?: string,
    runId?: string,
  ): Promise<void> {
    const actorId = this.cls.get(CLS_KEYS.userId) as string;
    const targetStatus = ACTION_TARGET[action];

    const items = await this.prisma.client.payrollItem.findMany({
      where: { id: { in: itemIds } },
      include: { payrollRun: { select: { branchId: true, id: true } } },
    });
    if (items.length !== itemIds.length) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Payroll item not found" });
    }
    for (const item of items) {
      this.assertBranchAccess(item.payrollRun.branchId);
      if (runId && item.payrollRun.id !== runId) {
        throw new ConflictException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: "Item does not belong to this payroll run",
        });
      }
      if (!PAYROLL_ITEM_TRANSITIONS[item.status].includes(targetStatus)) {
        throw new ConflictException({
          code:
            action === "approve" ? ERROR_CODES.PAYROLL_ITEM_NOT_PENDING : ERROR_CODES.PAYROLL_INVALID_TRANSITION,
          message: `Payroll item ${item.id} cannot transition from ${item.status} to ${targetStatus}`,
        });
      }
    }

    await this.prisma.client.$transaction(async (tx) => {
      const first = items[0]!;
      let batchId: string | undefined;
      if (action === "approve" || action === "reject") {
        const anyRunId = first.payrollRun.id;
        const count = await tx.payrollActionBatch.count({ where: { payrollRunId: anyRunId } });
        const batch = await tx.payrollActionBatch.create({
          data: {
            branchId: first.payrollRun.branchId,
            payrollRunId: anyRunId,
            action,
            batchNo: count + 1,
            performedBy: actorId,
          },
        });
        batchId = batch.id;
      }

      const now = new Date();
      const data: Prisma.PayrollItemUncheckedUpdateManyInput =
        action === "approve"
          ? { status: "approved", batchId, approvedBy: actorId, approvedAt: now }
          : action === "reject"
            ? { status: "rejected", batchId, rejectedBy: actorId, rejectedAt: now, rejectionReason: reason ?? null }
            : action === "mark-paid"
              ? { status: "paid", paidBy: actorId, paidAt: now }
              : { status: "pending", batchId: null, approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null, rejectionReason: null };

      await tx.payrollItem.updateMany({ where: { id: { in: itemIds } }, data });

      await this.audit.log(
        {
          action: `payroll_item.${action.replace("-", "_")}`,
          entityType: "payroll_item",
          entityId: itemIds.length === 1 ? itemIds[0] : undefined,
          after: { itemIds, count: itemIds.length },
        },
        tx,
      );
    });
  }

  /* ── Helpers ───────────────────────────────────────────────────────────── */

  private assertBranchAccess(branchId: string): void {
    const effective = getEffectiveBranchIds(this.cls);
    if (effective && !effective.includes(branchId)) {
      throw new ForbiddenException({
        code: ERROR_CODES.BRANCH_ACCESS_DENIED,
        message: "You do not have access to this branch",
      });
    }
  }

  private async getRunOrThrow(runId: string) {
    const run = await this.prisma.client.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Payroll run not found" });
    this.assertBranchAccess(run.branchId);
    return run;
  }

  private async findItemOrThrow(itemId: string): Promise<ItemDetailRow> {
    const item = await this.prisma.client.payrollItem.findUnique({
      where: { id: itemId },
      include: DETAIL_INCLUDE,
    });
    if (!item) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Payroll item not found" });
    this.assertBranchAccess(item.payrollRun.branchId);
    return item;
  }
}

function monthStringToDate(month: string): Date {
  return new Date(`${month}-01T00:00:00.000Z`);
}

function dateToMonthString(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function sumBigint(values: bigint[]): bigint {
  return values.reduce((sum, v) => sum + v, 0n);
}

function sumAdjustments(
  adjustments: { type: PayrollAdjustmentType; amountMinor: bigint }[],
  type: PayrollAdjustmentType,
): bigint {
  return sumBigint(adjustments.filter((a) => a.type === type).map((a) => a.amountMinor));
}

function toRunResponse(run: {
  id: string;
  branchId: string;
  payrollMonth: Date;
  currency: string;
  generatedBy: string;
  generatedAt: Date;
}): PayrollRunResponse {
  return {
    id: run.id,
    branchId: run.branchId,
    payrollMonth: dateToMonthString(run.payrollMonth),
    currency: run.currency,
    generatedBy: run.generatedBy,
    generatedAt: run.generatedAt,
  };
}

function toItemSummary(item: ItemRow): PayrollItemSummary {
  return {
    id: item.id,
    employee: {
      id: item.user.id,
      name: item.user.name,
      role: item.user.role?.nameEn ?? null,
      joiningDate: item.user.employeeProfile?.joiningDate ?? null,
      branchNameEn: item.payrollRun.branch.nameEn,
      branchNameAr: item.payrollRun.branch.nameAr,
    },
    currency: item.currency,
    baseSalaryMinor: Number(item.baseSalaryMinor),
    allowancesTotalMinor: Number(item.allowancesTotalMinor),
    statutoryDeductionsTotalMinor: Number(item.statutoryDeductionsTotalMinor),
    otherDeductionMinor: Number(item.otherDeductionMinor),
    absenceDeductionMinor: Number(item.absenceDeductionMinor),
    absentDays: Number(item.absentDays),
    leaveDeductionMinor: Number(item.leaveDeductionMinor),
    unpaidLeaveDays: Number(item.unpaidLeaveDays),
    additionsTotalMinor: Number(sumAdjustments(item.adjustments, "addition")),
    extraDeductionsTotalMinor: Number(sumAdjustments(item.adjustments, "deduction")),
    netPayMinor: Number(item.netPayMinor),
    status: item.status,
    batchNo: item.batch?.batchNo ?? null,
    paidDays: Number(item.paidDays),
    totalDaysInMonth: payrollMonthBounds(dateToMonthString(item.payrollRun.payrollMonth)).totalDays,
  };
}

function toItemDetail(item: ItemDetailRow): PayrollItemDetail {
  return {
    ...toItemSummary(item),
    payrollRunId: item.payrollRunId,
    branchId: item.payrollRun.branchId,
    payrollMonth: dateToMonthString(item.payrollRun.payrollMonth),
    allowanceComponents: item.components
      .filter((c) => c.category === "allowance")
      .map(toComponentLine),
    statutoryDeductionComponents: item.components
      .filter((c) => c.category === "deduction")
      .map(toComponentLine),
    additions: item.adjustments.filter((a) => a.type === "addition").map(toAdjustmentLine),
    extraDeductions: item.adjustments.filter((a) => a.type === "deduction").map(toAdjustmentLine),
    approvedAt: item.approvedAt,
    rejectedAt: item.rejectedAt,
    rejectionReason: item.rejectionReason,
    paidAt: item.paidAt,
  };
}

function toComponentLine(c: {
  category: "allowance" | "deduction";
  nameEn: string;
  nameAr: string;
  amountMinor: bigint;
}) {
  return { category: c.category, nameEn: c.nameEn, nameAr: c.nameAr, amountMinor: Number(c.amountMinor) };
}

function toAdjustmentLine(a: {
  id: string;
  type: PayrollAdjustmentType;
  labelEn: string;
  labelAr: string | null;
  amountMinor: bigint;
}) {
  return { id: a.id, type: a.type, labelEn: a.labelEn, labelAr: a.labelAr, amountMinor: Number(a.amountMinor) };
}

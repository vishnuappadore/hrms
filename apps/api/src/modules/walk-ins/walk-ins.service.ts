import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Prisma } from "@prisma/client";
import {
  ERROR_CODES,
  WALKIN_TRANSITIONS,
  type AssignWalkInBarberInput,
  type CreateWalkInInput,
  type ListWalkInsQuery,
  type Paginated,
  type UpdateWalkInInput,
  type WalkIn as WalkInResponse,
  type WalkInStats,
  type WalkInStatus,
} from "@keystonehr/shared";
import { CLS_KEYS, getEffectiveBranchIds } from "../../common/request-context";
import { assertBarberAvailable } from "../../common/barber";
import { PrismaService, type TxClient } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";

/** Full row shape returned to the client — one include reused everywhere. */
const WALKIN_INCLUDE = {
  branch: { select: { id: true, nameEn: true, nameAr: true } },
  customer: { select: { id: true, name: true, mobile: true } },
  barber: { select: { id: true, name: true } },
  services: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.WalkInQueueEntryInclude;

type WalkInRow = Prisma.WalkInQueueEntryGetPayload<{ include: typeof WALKIN_INCLUDE }>;

@Injectable()
export class WalkInsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
  ) {}

  async list(query: ListWalkInsQuery): Promise<Paginated<WalkInResponse>> {
    const effectiveBranchIds = getEffectiveBranchIds(this.cls);
    let branchIdFilter: Prisma.WalkInQueueEntryWhereInput["branchId"];
    if (query.branchId) {
      branchIdFilter =
        effectiveBranchIds && !effectiveBranchIds.includes(query.branchId)
          ? { in: [] }
          : query.branchId;
    } else if (effectiveBranchIds) {
      branchIdFilter = { in: effectiveBranchIds };
    }

    const where: Prisma.WalkInQueueEntryWhereInput = {
      ...(branchIdFilter !== undefined ? { branchId: branchIdFilter } : {}),
      ...(query.boardSince
        ? {
            AND: [
              {
                OR: [
                  { status: { in: ["waiting", "serving"] } },
                  { status: "completed", completedAt: { gte: query.boardSince } },
                ],
              },
            ],
          }
        : query.status
          ? { status: query.status }
          : {}),
      ...(query.search
        ? {
            OR: [
              { customerName: { contains: query.search, mode: "insensitive" } },
              { mobileNumber: { contains: query.search, mode: "insensitive" } },
              { customer: { name: { contains: query.search, mode: "insensitive" } } },
              { customer: { mobile: { contains: query.search, mode: "insensitive" } } },
              {
                services: {
                  some: {
                    OR: [
                      { nameEn: { contains: query.search, mode: "insensitive" } },
                      { nameAr: { contains: query.search, mode: "insensitive" } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };

    const orderBy = parseSort(query.sort) ?? { queuedAt: "desc" as const };
    const [total, data] = await Promise.all([
      this.prisma.client.walkInQueueEntry.count({ where }),
      this.prisma.client.walkInQueueEntry.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: WALKIN_INCLUDE,
      }),
    ]);

    return {
      data: data.map(toWalkInResponse),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  /**
   * Dashboard KPI cards. Average Wait is an implementation choice (the client
   * req doesn't pin down the exact computation — docs/MODULES/pos.md flags
   * it as open): mean minutes of (servingStartedAt ?? completedAt − queuedAt)
   * over today's entries that have left Waiting (serving/completed), scoped
   * to entries queued today.
   */
  async stats(branchId?: string): Promise<WalkInStats> {
    const effectiveBranchIds = getEffectiveBranchIds(this.cls);
    const branchWhere: Prisma.WalkInQueueEntryWhereInput =
      branchId !== undefined
        ? { branchId }
        : effectiveBranchIds
          ? { branchId: { in: effectiveBranchIds } }
          : {};

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    const [inQueue, servingNow, doneToday, waitSample] = await Promise.all([
      this.prisma.client.walkInQueueEntry.count({ where: { ...branchWhere, status: "waiting" } }),
      this.prisma.client.walkInQueueEntry.count({ where: { ...branchWhere, status: "serving" } }),
      this.prisma.client.walkInQueueEntry.count({
        where: { ...branchWhere, status: "completed", completedAt: { gte: dayStart } },
      }),
      this.prisma.client.walkInQueueEntry.findMany({
        where: {
          ...branchWhere,
          status: { in: ["serving", "completed"] },
          queuedAt: { gte: dayStart },
        },
        select: { queuedAt: true, servingStartedAt: true, completedAt: true },
      }),
    ]);

    let avgWaitMinutes: number | null = null;
    if (waitSample.length > 0) {
      const totalMs = waitSample.reduce((sum, e) => {
        const left = e.servingStartedAt ?? e.completedAt ?? e.queuedAt;
        return sum + (left.getTime() - e.queuedAt.getTime());
      }, 0);
      avgWaitMinutes = Math.round(totalMs / waitSample.length / 60_000);
    }

    return { inQueue, servingNow, doneToday, avgWaitMinutes };
  }

  async create(input: CreateWalkInInput): Promise<WalkInResponse> {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const userId = this.cls.get(CLS_KEYS.userId) as string;

    return this.prisma.withTenantTx(async (tx) => {
      const branch = await tx.branch.findUnique({
        where: { id: input.branchId },
        select: { id: true, currency: true },
      });
      if (!branch) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Branch not found" });
      }

      if (input.barberStaffId) {
        await assertBarberAvailable(tx, input.branchId, input.barberStaffId);
      }

      // snapshot the selected services at their per-branch price (same
      // discipline as AppointmentsService.resolveServiceLines)
      const lines = await this.resolveServiceLines(tx, input.branchId, input.serviceIds);
      const totalMinor = lines.reduce((sum, l) => sum + l.priceMinor, 0n);

      const { customerId, customerName } = await this.resolveCustomer(tx, tenantId, userId, input);

      const created = await tx.walkInQueueEntry.create({
        data: {
          tenantId,
          branchId: input.branchId,
          customerId,
          customerName,
          mobileNumber: input.mobileNumber ?? null,
          barberStaffId: input.barberStaffId ?? null,
          status: "waiting",
          queuedAt: new Date(),
          totalMinor,
          currency: branch.currency,
          createdBy: userId,
          services: {
            create: lines.map((l) => ({
              tenantId,
              serviceId: l.serviceId,
              nameEn: l.nameEn,
              nameAr: l.nameAr,
              unitPriceMinor: l.priceMinor,
              durationMinutes: l.durationMinutes,
            })),
          },
        },
        include: WALKIN_INCLUDE,
      });

      await this.audit.log(
        {
          action: "walkin.created",
          entityType: "walk_in_queue_entry",
          entityId: created.id,
          after: { status: created.status },
        },
        tx,
      );
      return toWalkInResponse(created);
    });
  }

  async getById(id: string): Promise<WalkInResponse> {
    return toWalkInResponse(await this.findScoped(id));
  }

  /**
   * Edits entered details (customer identity + selected services) on an
   * existing entry. Only allowed while the entry hasn't left the active
   * queue (waiting/serving) — once completed/cancelled the record (and any
   * linked invoice from POS checkout) is final. serviceIds, when given,
   * always re-snapshot prices/totalMinor server-side, same as create().
   */
  async update(id: string, input: UpdateWalkInInput): Promise<WalkInResponse> {
    const current = await this.findScoped(id);
    if (current.status !== "waiting" && current.status !== "serving") {
      throw new ConflictException({
        code: ERROR_CODES.WALKIN_NOT_EDITABLE,
        message: `Cannot edit a walk-in that is already ${current.status}`,
      });
    }
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const userId = this.cls.get(CLS_KEYS.userId) as string;

    return this.prisma.withTenantTx(async (tx) => {
      const data: Prisma.WalkInQueueEntryUpdateInput = { updatedBy: userId };

      if (input.serviceIds !== undefined) {
        const lines = await this.resolveServiceLines(tx, current.branchId, input.serviceIds);
        data.totalMinor = lines.reduce((sum, l) => sum + l.priceMinor, 0n);
        data.services = {
          deleteMany: {},
          create: lines.map((l) => ({
            tenantId,
            serviceId: l.serviceId,
            nameEn: l.nameEn,
            nameAr: l.nameAr,
            unitPriceMinor: l.priceMinor,
            durationMinutes: l.durationMinutes,
          })),
        };
      }

      if (input.mobileNumber !== undefined || input.customerName !== undefined) {
        const mobileNumber =
          input.mobileNumber !== undefined ? input.mobileNumber : current.mobileNumber;
        const customerName =
          input.customerName !== undefined ? input.customerName : current.customerName;
        const resolved = await this.resolveCustomer(tx, tenantId, userId, {
          mobileNumber,
          customerName,
        });
        data.mobileNumber = mobileNumber;
        data.customer = resolved.customerId
          ? { connect: { id: resolved.customerId } }
          : { disconnect: true };
        data.customerName = resolved.customerName;
      }

      const updated = await tx.walkInQueueEntry.update({
        where: { id },
        data,
        include: WALKIN_INCLUDE,
      });

      await this.audit.log(
        {
          action: "walkin.updated",
          entityType: "walk_in_queue_entry",
          entityId: id,
          before: toWalkInResponse(current),
          after: toWalkInResponse(updated),
        },
        tx,
      );
      return toWalkInResponse(updated);
    });
  }

  async assignBarber(id: string, input: AssignWalkInBarberInput): Promise<WalkInResponse> {
    const current = await this.findScoped(id);
    // Same rule as update(): completed/cancelled entries are final — reassigning the barber after
    // checkout would rewrite who served (and later, who earns commission on) an invoiced visit.
    if (current.status !== "waiting" && current.status !== "serving") {
      throw new ConflictException({
        code: ERROR_CODES.WALKIN_NOT_EDITABLE,
        message: `Cannot reassign the barber on a walk-in that is already ${current.status}`,
      });
    }
    const userId = this.cls.get(CLS_KEYS.userId) as string;

    return this.prisma.withTenantTx(async (tx) => {
      if (input.barberStaffId) {
        await assertBarberAvailable(tx, current.branchId, input.barberStaffId);
      }
      const updated = await tx.walkInQueueEntry.update({
        where: { id },
        data: { barberStaffId: input.barberStaffId, updatedBy: userId },
        include: WALKIN_INCLUDE,
      });
      await this.audit.log(
        {
          action: "walkin.barber_assigned",
          entityType: "walk_in_queue_entry",
          entityId: id,
          before: { barberStaffId: current.barberStaffId },
          after: { barberStaffId: input.barberStaffId },
        },
        tx,
      );
      return toWalkInResponse(updated);
    });
  }

  /** Drive the status machine; rejects transitions not in WALKIN_TRANSITIONS. */
  async transition(id: string, status: WalkInStatus): Promise<WalkInResponse> {
    const current = await this.findScoped(id);
    const userId = this.cls.get(CLS_KEYS.userId) as string;

    if (current.status === status) {
      return toWalkInResponse(current);
    }
    const allowed = WALKIN_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(status)) {
      throw new ConflictException({
        code: ERROR_CODES.INVALID_STATUS_TRANSITION,
        message: `Cannot move walk-in from ${current.status} to ${status}`,
      });
    }

    return this.prisma.withTenantTx(async (tx) => {
      const updated = await tx.walkInQueueEntry.update({
        where: { id },
        data: {
          status,
          updatedBy: userId,
          ...(status === "serving" ? { servingStartedAt: new Date() } : {}),
          ...(status === "completed" ? { completedAt: new Date() } : {}),
        },
        include: WALKIN_INCLUDE,
      });
      await this.audit.log(
        {
          action: "walkin.status_changed",
          entityType: "walk_in_queue_entry",
          entityId: id,
          before: { status: current.status },
          after: { status },
        },
        tx,
      );
      return toWalkInResponse(updated);
    });
  }

  /* ── Helpers ────────────────────────────────────────────────────────────── */

  private async findScoped(id: string): Promise<WalkInRow> {
    const effectiveBranchIds = getEffectiveBranchIds(this.cls);
    const entry = await this.prisma.client.walkInQueueEntry.findFirst({
      where: { id, ...(effectiveBranchIds ? { branchId: { in: effectiveBranchIds } } : {}) },
      include: WALKIN_INCLUDE,
    });
    if (!entry) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Walk-in not found" });
    }
    return entry;
  }

  /** Load + validate the selected services, resolving the per-branch price (mirrors AppointmentsService). */
  private async resolveServiceLines(tx: TxClient, branchId: string, serviceIds: string[]) {
    const unique = [...new Set(serviceIds)];
    const services = await tx.service.findMany({
      where: { id: { in: unique }, status: "active", deletedAt: null },
      include: { branchOverrides: { where: { branchId } } },
    });
    if (services.length !== unique.length) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "One or more selected services are unavailable",
      });
    }
    const byId = new Map(services.map((s) => [s.id, s]));
    return unique.map((id) => {
      const s = byId.get(id)!;
      const override = s.branchOverrides[0];
      if (override?.isAvailable === false) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: "One or more selected services are not offered at this branch",
        });
      }
      const priceMinor = override?.priceOverrideMinor ?? s.priceMinor;
      return {
        serviceId: s.id,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        priceMinor,
        durationMinutes: s.durationMinutes,
      };
    });
  }

  /**
   * Optional customer identity: a mobile number links an existing customer
   * (its name wins on match) or auto-creates one (per product decision — see
   * docs/MODULES/customers.md single-source-of-truth principle); no mobile
   * at all stays fully anonymous (customerId null, customerName as typed —
   * the UI renders "Walk-in Guest" client-side when blank).
   */
  private async resolveCustomer(
    tx: TxClient,
    tenantId: string,
    userId: string,
    input: Pick<CreateWalkInInput, "mobileNumber" | "customerName">,
  ): Promise<{ customerId: string | null; customerName: string | null }> {
    if (input.mobileNumber) {
      // upsert on the (tenant, mobile) unique key: links an existing customer or
      // creates one, race-safe (same pattern as AppointmentsService.resolveCustomer).
      const customer = await tx.customer.upsert({
        where: { tenantId_mobile: { tenantId, mobile: input.mobileNumber } },
        create: {
          tenantId,
          mobile: input.mobileNumber,
          name: input.customerName?.trim() || input.mobileNumber,
          createdBy: userId,
        },
        update: {},
        select: { id: true, name: true },
      });
      // The customer record's name wins on match (single source of truth) — EXCEPT when it is still
      // the auto-created placeholder (the mobile number itself). Then a typed name upgrades it, so
      // naming an anonymous walk-in actually sticks instead of being silently discarded.
      const typedName = input.customerName?.trim();
      if (typedName && customer.name === input.mobileNumber && typedName !== customer.name) {
        const renamed = await tx.customer.update({
          where: { id: customer.id },
          data: { name: typedName },
          select: { id: true, name: true },
        });
        return { customerId: renamed.id, customerName: renamed.name };
      }
      return { customerId: customer.id, customerName: customer.name };
    }
    return { customerId: null, customerName: input.customerName?.trim() || null };
  }
}

function toWalkInResponse(row: WalkInRow): WalkInResponse {
  return {
    id: row.id,
    branchId: row.branchId,
    branch: row.branch,
    customerId: row.customerId,
    customer: row.customer,
    customerName: row.customerName,
    mobileNumber: row.mobileNumber,
    barberStaffId: row.barberStaffId,
    barber: row.barber,
    status: row.status,
    queuedAt: row.queuedAt,
    servingStartedAt: row.servingStartedAt,
    completedAt: row.completedAt,
    totalMinor: Number(row.totalMinor),
    currency: row.currency,
    services: row.services.map((s) => ({
      serviceId: s.serviceId,
      nameEn: s.nameEn,
      nameAr: s.nameAr,
      priceMinor: Number(s.unitPriceMinor),
      durationMinutes: s.durationMinutes,
    })),
    invoiceId: row.invoiceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseSort(sort?: string): Record<string, "asc" | "desc"> | undefined {
  if (!sort) return undefined;
  const desc = sort.startsWith("-");
  const field = desc ? sort.slice(1) : sort;
  const allowed = new Set(["queuedAt", "createdAt", "status"]);
  if (!allowed.has(field)) return undefined;
  return { [field]: desc ? "desc" : "asc" };
}

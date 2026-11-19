import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Prisma } from "@prisma/client";
import {
  APPOINTMENT_TRANSITIONS,
  ERROR_CODES,
  type Appointment as AppointmentResponse,
  type AppointmentBarber,
  type AppointmentSlot,
  type CreateAppointmentInput,
  type ListAppointmentsQuery,
  type ListBarbersQuery,
  type ListSlotsQuery,
  type Paginated,
  type TransitionAppointmentInput,
  type UpdateAppointmentInput,
} from "@keystonehr/shared";
import { CLS_KEYS, getEffectiveBranchIds } from "../../common/request-context";
import { assertBarberAvailable, bookableBarberWhere } from "../../common/barber";
import { PrismaService, type TxClient } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";

/** Full row shape returned to the client — one include reused everywhere. */
const APPOINTMENT_INCLUDE = {
  branch: { select: { id: true, nameEn: true, nameAr: true } },
  customer: { select: { id: true, name: true, mobile: true } },
  barber: { select: { id: true, name: true } },
  services: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.AppointmentInclude;

type AppointmentRow = Prisma.AppointmentGetPayload<{ include: typeof APPOINTMENT_INCLUDE }>;

/** getById also returns the status-change timeline for the details modal. */
const APPOINTMENT_DETAIL_INCLUDE = {
  ...APPOINTMENT_INCLUDE,
  history: {
    orderBy: { createdAt: "asc" as const },
    select: { fromStatus: true, toStatus: true, createdAt: true },
  },
} satisfies Prisma.AppointmentInclude;

type AppointmentDetailRow = Prisma.AppointmentGetPayload<{
  include: typeof APPOINTMENT_DETAIL_INCLUDE;
}>;

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
  ) {}

  async list(query: ListAppointmentsQuery): Promise<Paginated<AppointmentResponse>> {
    const effectiveBranchIds = getEffectiveBranchIds(this.cls);
    // Intersect the requested branch with the caller's effective branches so a
    // ?branchId= param can never widen access beyond getEffectiveBranchIds.
    // (The @BranchScoped guard also 403s an out-of-scope branchId up front; this
    // keeps the no-param path and any future caller safe regardless.)
    let branchIdFilter: Prisma.AppointmentWhereInput["branchId"];
    if (query.branchId) {
      branchIdFilter =
        effectiveBranchIds && !effectiveBranchIds.includes(query.branchId)
          ? { in: [] }
          : query.branchId;
    } else if (effectiveBranchIds) {
      branchIdFilter = { in: effectiveBranchIds };
    }
    const where: Prisma.AppointmentWhereInput = {
      ...(branchIdFilter !== undefined ? { branchId: branchIdFilter } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.barberId ? { barberId: query.barberId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.from || query.to
        ? {
            scheduledStart: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { appointmentNo: { contains: query.search, mode: "insensitive" } },
              { customer: { name: { contains: query.search, mode: "insensitive" } } },
              { customer: { mobile: { contains: query.search, mode: "insensitive" } } },
              { customerName: { contains: query.search, mode: "insensitive" } },
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

    const orderBy = parseSort(query.sort) ?? { scheduledStart: "desc" as const };
    const [total, data] = await Promise.all([
      this.prisma.client.appointment.count({ where }),
      this.prisma.client.appointment.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: APPOINTMENT_INCLUDE,
      }),
    ]);

    return {
      data: data.map(toAppointmentResponse),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async getById(id: string): Promise<AppointmentResponse> {
    const effectiveBranchIds = getEffectiveBranchIds(this.cls);
    const appointment = await this.prisma.client.appointment.findFirst({
      where: { id, ...(effectiveBranchIds ? { branchId: { in: effectiveBranchIds } } : {}) },
      include: APPOINTMENT_DETAIL_INCLUDE,
    });
    if (!appointment) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Appointment not found" });
    }
    return toAppointmentResponse(appointment);
  }

  async create(input: CreateAppointmentInput): Promise<AppointmentResponse> {
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

      // barber must be an active "Barber" who works this branch — same predicate
      // as listBarbers, so the API can only create what the wizard could produce
      await assertBarberAvailable(tx, input.branchId, input.barberId);

      // snapshot the selected services at their per-branch price
      const lines = await this.resolveServiceLines(tx, input.branchId, input.serviceIds);
      const totalMinor = lines.reduce((sum, l) => sum + l.priceMinor, 0n);
      const durationMinutes = lines.reduce((sum, l) => sum + l.durationMinutes + l.bufferMinutes, 0);
      const scheduledEnd = new Date(input.scheduledStart.getTime() + durationMinutes * 60_000);

      const customerId = await this.resolveCustomer(tx, tenantId, userId, input);
      const appointmentNo = await this.nextAppointmentNo(tx, tenantId);

      const created = await tx.appointment.create({
        data: {
          tenantId,
          branchId: input.branchId,
          appointmentNo,
          customerId,
          customerName: customerId ? null : input.customerName?.trim() || null,
          barberId: input.barberId,
          status: "waiting",
          scheduledStart: input.scheduledStart,
          scheduledEnd,
          durationMinutes,
          totalMinor,
          currency: branch.currency,
          notes: input.notes ?? null,
          createdBy: userId,
          services: {
            create: lines.map((l) => ({
              tenantId,
              serviceId: l.serviceId,
              nameEn: l.nameEn,
              nameAr: l.nameAr,
              priceMinor: l.priceMinor,
              durationMinutes: l.durationMinutes,
              bufferMinutes: l.bufferMinutes,
            })),
          },
          history: {
            create: { tenantId, fromStatus: null, toStatus: "waiting", changedBy: userId },
          },
        },
        include: APPOINTMENT_INCLUDE,
      });

      await this.audit.log(
        {
          action: "appointment.created",
          entityType: "appointment",
          entityId: created.id,
          after: { appointmentNo: created.appointmentNo, status: created.status },
        },
        tx,
      );
      return toAppointmentResponse(created);
    });
  }

  /**
   * Edit barber/services/schedule on an existing appointment. Customer
   * identity isn't editable (same as `create()` has no "re-link" concept).
   * Only allowed while the appointment hasn't moved past `waiting`/
   * `confirmed` — once a barber has started or finished the service (or it's
   * cancelled), the record is final, same convention as `WalkInsService`.
   */
  async update(id: string, input: UpdateAppointmentInput): Promise<AppointmentResponse> {
    const current = await this.findScoped(id);
    if (current.status !== "waiting" && current.status !== "confirmed") {
      throw new ConflictException({
        code: ERROR_CODES.APPOINTMENT_NOT_EDITABLE,
        message: `Cannot edit an appointment that is already ${current.status}`,
      });
    }
    const userId = this.cls.get(CLS_KEYS.userId) as string;
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;

    return this.prisma.withTenantTx(async (tx) => {
      // Re-check editability under a row lock: the status read above is outside this transaction,
      // so a concurrent Start (→ in_progress) could otherwise be overwritten by this edit.
      const { count } = await tx.appointment.updateMany({
        where: { id, status: { in: ["waiting", "confirmed"] } },
        data: { updatedBy: userId },
      });
      if (count !== 1) {
        throw new ConflictException({
          code: ERROR_CODES.APPOINTMENT_NOT_EDITABLE,
          message: "Cannot edit an appointment that has already started, finished or been cancelled",
        });
      }

      if (input.barberId) {
        await assertBarberAvailable(tx, current.branchId, input.barberId);
      }

      const data: Prisma.AppointmentUncheckedUpdateInput = { updatedBy: userId };
      if (input.barberId) {
        data.barberId = input.barberId;
      }

      let durationMinutes = current.durationMinutes;
      if (input.serviceIds) {
        const lines = await this.resolveServiceLines(tx, current.branchId, input.serviceIds);
        durationMinutes = lines.reduce((sum, l) => sum + l.durationMinutes + l.bufferMinutes, 0);
        data.totalMinor = lines.reduce((sum, l) => sum + l.priceMinor, 0n);
        data.durationMinutes = durationMinutes;
        data.services = {
          deleteMany: {},
          create: lines.map((l) => ({
            tenantId,
            serviceId: l.serviceId,
            nameEn: l.nameEn,
            nameAr: l.nameAr,
            priceMinor: l.priceMinor,
            durationMinutes: l.durationMinutes,
            bufferMinutes: l.bufferMinutes,
          })),
        };
      }

      if (input.scheduledStart || input.serviceIds) {
        const scheduledStart = input.scheduledStart ?? current.scheduledStart;
        data.scheduledStart = scheduledStart;
        data.scheduledEnd = new Date(scheduledStart.getTime() + durationMinutes * 60_000);
      }

      const updated = await tx.appointment.update({
        where: { id },
        data,
        include: APPOINTMENT_INCLUDE,
      });

      await this.audit.log(
        {
          action: "appointment.updated",
          entityType: "appointment",
          entityId: id,
          before: toAppointmentResponse(current),
          after: toAppointmentResponse(updated),
        },
        tx,
      );
      return toAppointmentResponse(updated);
    });
  }

  /** Drive the status machine; rejects transitions not in APPOINTMENT_TRANSITIONS. */
  async transition(id: string, input: TransitionAppointmentInput): Promise<AppointmentResponse> {
    const current = await this.findScoped(id);
    const userId = this.cls.get(CLS_KEYS.userId) as string;
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;

    if (current.status === input.status) {
      return toAppointmentResponse(current);
    }
    const allowed = APPOINTMENT_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new ConflictException({
        code: ERROR_CODES.INVALID_STATUS_TRANSITION,
        message: `Cannot move appointment from ${current.status} to ${input.status}`,
      });
    }

    return this.prisma.withTenantTx(async (tx) => {
      const updated = await tx.appointment.update({
        where: { id },
        data: {
          status: input.status,
          updatedBy: userId,
          history: {
            create: {
              tenantId,
              fromStatus: current.status,
              toStatus: input.status,
              changedBy: userId,
            },
          },
        },
        include: APPOINTMENT_INCLUDE,
      });
      await this.audit.log(
        {
          action: "appointment.status_changed",
          entityType: "appointment",
          entityId: id,
          before: { status: current.status },
          after: { status: input.status },
        },
        tx,
      );
      return toAppointmentResponse(updated);
    });
  }

  /**
   * Step 2 barber cards. No staff-schedule model exists yet (Phase 7): barbers
   * are active Users with the "Barber" role assigned to the branch (or all
   * branches). `busy` = currently has an in-progress appointment.
   */
  async listBarbers(query: ListBarbersQuery): Promise<AppointmentBarber[]> {
    const barbers = await this.prisma.client.user.findMany({
      where: bookableBarberWhere(query.branchId),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    if (barbers.length === 0) return [];

    const busy = await this.prisma.client.appointment.groupBy({
      by: ["barberId"],
      where: { barberId: { in: barbers.map((b) => b.id) }, status: "in_progress" },
    });
    const busyIds = new Set(busy.map((b) => b.barberId));

    return barbers.map((b) => ({ id: b.id, name: b.name, busy: busyIds.has(b.id) }));
  }

  /**
   * Step 3 time slots. Generated from the branch working hours; double-booking
   * is allowed (2026 spec), so `taken` is informational — a slot the barber
   * already has a non-cancelled appointment overlapping.
   */
  // NOTE (timezone): slots are generated and compared in the API process's
  // local time (`new Date("YYYY-MM-DDThh:mm:00")` has no offset). There is no
  // per-branch timezone model yet, so deployments must run the API in the
  // salon's timezone until a `branch.timezone` field lands (follow-up). The
  // `taken` overlap is intentionally cross-branch: one barber can't be in two
  // places, so a booking at any branch marks the slot busy.
  async listSlots(query: ListSlotsQuery): Promise<AppointmentSlot[]> {
    const branch = await this.prisma.client.branch.findUnique({
      where: { id: query.branchId },
      select: { workingHours: true },
    });
    if (!branch) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Branch not found" });
    }
    const hours = branch.workingHours as {
      openingTime?: string;
      closingTime?: string;
      weeklyOffDays?: string[] | null;
    } | null;
    const opening = hours?.openingTime ?? "09:00";
    const closing = hours?.closingTime ?? "21:00";

    const dayStart = new Date(`${query.date}T00:00:00`);
    if (Number.isNaN(dayStart.getTime())) {
      throw new BadRequestException({ code: ERROR_CODES.VALIDATION_FAILED, message: "Invalid date" });
    }
    // closed on a weekly off day → no slots
    if (hours?.weeklyOffDays?.includes(WEEKDAYS[dayStart.getDay()]!)) {
      return [];
    }

    const openMin = toMinutes(opening);
    const closeMin = toMinutes(closing);
    const step = 30;
    const dayEnd = new Date(`${query.date}T23:59:59`);

    const existing = await this.prisma.client.appointment.findMany({
      where: {
        barberId: query.barberId,
        status: { not: "cancelled" },
        scheduledStart: { gte: dayStart, lte: dayEnd },
        ...(query.excludeAppointmentId ? { id: { not: query.excludeAppointmentId } } : {}),
      },
      select: { scheduledStart: true, scheduledEnd: true },
    });

    const slots: AppointmentSlot[] = [];
    for (let m = openMin; m + query.durationMinutes <= closeMin; m += step) {
      const time = fromMinutes(m);
      const startsAt = new Date(`${query.date}T${time}:00`);
      const endsAt = new Date(startsAt.getTime() + query.durationMinutes * 60_000);
      const taken = existing.some(
        (a) => a.scheduledStart < endsAt && a.scheduledEnd > startsAt,
      );
      slots.push({ time, startsAt, taken });
    }
    return slots;
  }

  /* ── Helpers ────────────────────────────────────────────────────────────── */

  private async findScoped(id: string): Promise<AppointmentRow> {
    const effectiveBranchIds = getEffectiveBranchIds(this.cls);
    const appointment = await this.prisma.client.appointment.findFirst({
      where: { id, ...(effectiveBranchIds ? { branchId: { in: effectiveBranchIds } } : {}) },
      include: APPOINTMENT_INCLUDE,
    });
    if (!appointment) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Appointment not found" });
    }
    return appointment;
  }

  /** Load + validate the selected services, resolving the per-branch price. */
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
    // preserve the caller's order
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
        bufferMinutes: s.bufferMinutes,
      };
    });
  }

  /**
   * Optional customer identity (2026 spec): explicit id → link; mobile →
   * link-or-create; nothing → no customer. Returns the resolved id or null.
   */
  private async resolveCustomer(
    tx: TxClient,
    tenantId: string,
    userId: string,
    input: CreateAppointmentInput,
  ): Promise<string | null> {
    if (input.customerId) {
      const existing = await tx.customer.findFirst({
        where: { id: input.customerId },
        select: { id: true },
      });
      if (!existing) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: "Selected customer does not exist",
        });
      }
      return existing.id;
    }
    if (input.customerMobile) {
      // upsert on the (tenant, mobile) unique key: links an existing customer or
      // creates one, race-safe — a plain findFirst-then-create would 500 (and
      // poison the transaction) if two bookings register the same new mobile.
      const customer = await tx.customer.upsert({
        where: { tenantId_mobile: { tenantId, mobile: input.customerMobile } },
        create: {
          tenantId,
          mobile: input.customerMobile,
          name: input.customerName?.trim() || input.customerMobile,
          createdBy: userId,
        },
        update: {},
        select: { id: true },
      });
      return customer.id;
    }
    return null;
  }

  /** Unique per-tenant display ref: APT-<year>-<6 digits>. Count-based (see CLAUDE.md). */
  private async nextAppointmentNo(tx: TxClient, tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `APT-${year}-`;
    const count = await tx.appointment.count({
      where: { tenantId, appointmentNo: { startsWith: prefix } },
    });
    return `${prefix}${String(count + 1).padStart(6, "0")}`;
  }
}

function toAppointmentResponse(row: AppointmentRow | AppointmentDetailRow): AppointmentResponse {
  return {
    history:
      "history" in row
        ? row.history.map((h) => ({ fromStatus: h.fromStatus, toStatus: h.toStatus, at: h.createdAt }))
        : undefined,
    id: row.id,
    appointmentNo: row.appointmentNo,
    branchId: row.branchId,
    branch: row.branch,
    customerId: row.customerId,
    customer: row.customer,
    customerName: row.customerName,
    barberId: row.barberId,
    barber: row.barber,
    status: row.status,
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
    durationMinutes: row.durationMinutes,
    totalMinor: Number(row.totalMinor),
    currency: row.currency,
    services: row.services.map((s) => ({
      serviceId: s.serviceId,
      nameEn: s.nameEn,
      nameAr: s.nameAr,
      priceMinor: Number(s.priceMinor),
      durationMinutes: s.durationMinutes,
    })),
    notes: row.notes,
    invoiceId: row.invoiceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseSort(sort?: string): Record<string, "asc" | "desc"> | undefined {
  if (!sort) return undefined;
  const desc = sort.startsWith("-");
  const field = desc ? sort.slice(1) : sort;
  const allowed = new Set(["scheduledStart", "createdAt", "status", "appointmentNo"]);
  if (!allowed.has(field)) return undefined;
  return { [field]: desc ? "desc" : "asc" };
}

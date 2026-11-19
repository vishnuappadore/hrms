import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ERROR_CODES,
  type CreateLeaveTypeInput,
  type LeaveType as LeaveTypeResponse,
  type UpdateLeaveTypeInput,
} from "@keystonehr/shared";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { LeaveService } from "../leave/leave.service";

type LeaveTypeRow = Prisma.LeaveTypeGetPayload<Record<string, never>>;

@Injectable()
export class LeaveTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly leave: LeaveService,
  ) {}

  async list(includeInactive = false): Promise<LeaveTypeResponse[]> {
    const types = await this.prisma.client.leaveType.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
    });
    return types.map(toLeaveTypeResponse);
  }

  async create(input: CreateLeaveTypeInput): Promise<LeaveTypeResponse> {
    await this.assertNameFree(input.nameEn);

    const created = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.leaveType.create({
        data: { ...input },
      });
      await this.audit.log(
        {
          action: "leave_type.created",
          entityType: "leave_type",
          entityId: created.id,
          after: { nameEn: created.nameEn },
        },
        tx,
      );
      return created;
    });

    // Credit every currently-eligible employee immediately, rather than leaving the new
    // type at accrued: 0 until the next nightly leave-accrual run (docs/MODULES/leave.md).
    if (created.isActive) {
      await this.leave.creditNewLeaveType(created);
    }

    return toLeaveTypeResponse(created);
  }

  async update(id: string, input: UpdateLeaveTypeInput): Promise<LeaveTypeResponse> {
    const existing = await this.prisma.client.leaveType.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Leave type not found" });
    }
    if (input.nameEn && input.nameEn !== existing.nameEn) {
      await this.assertNameFree(input.nameEn, id);
    }

    return this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.leaveType.update({ where: { id }, data: input });
      await this.audit.log(
        {
          action: "leave_type.updated",
          entityType: "leave_type",
          entityId: id,
          after: { nameEn: updated.nameEn, isActive: updated.isActive },
        },
        tx,
      );
      return toLeaveTypeResponse(updated);
    });
  }

  private async assertNameFree(nameEn: string, excludeId?: string): Promise<void> {
    const clash = await this.prisma.client.leaveType.findFirst({
      where: { nameEn, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException({
        code: ERROR_CODES.NAME_EXISTS,
        message: `A leave type named "${nameEn}" already exists`,
      });
    }
  }
}

function toLeaveTypeResponse(row: LeaveTypeRow): LeaveTypeResponse {
  return {
    id: row.id,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    isPaid: row.isPaid,
    daysPerYear: Number(row.daysPerYear),
    countMode: row.countMode,
    isEncashable: row.isEncashable,
    creditPolicy: row.creditPolicy,
    minimumNoticeDays: row.minimumNoticeDays,
    maxCarryForwardDays: row.maxCarryForwardDays,
    allowCarryForward: row.allowCarryForward,
    allowHalfDay: row.allowHalfDay,
    requireSupportingDocument: row.requireSupportingDocument,
    allowNegativeBalance: row.allowNegativeBalance,
    requiresSecondApproval: row.requiresSecondApproval,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

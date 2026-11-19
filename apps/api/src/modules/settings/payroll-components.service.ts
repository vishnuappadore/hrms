import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Prisma } from "@prisma/client";
import {
  ERROR_CODES,
  type PayrollComponent as PayrollComponentResponse,
  type PayrollComponentCategory,
  type PayrollComponentListItemInput,
  type SavePayrollComponentsInput,
} from "@keystonehr/shared";
import { CLS_KEYS } from "../../common/request-context";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";

type PayrollComponentRow = Prisma.PayrollComponentGetPayload<Record<string, never>>;

@Injectable()
export class PayrollComponentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
  ) {}

  async list(category?: PayrollComponentCategory): Promise<PayrollComponentResponse[]> {
    const components = await this.prisma.client.payrollComponent.findMany({
      where: { isActive: true, ...(category ? { category } : {}) },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { nameEn: "asc" }],
    });
    return components.map(toPayrollComponentResponse);
  }

  /**
   * Replaces the full active set for one category in a single call, matching
   * the Settings screen's batched add/edit/remove + one "Save Changes" button:
   * items with an id are updated, items without one are created, and active
   * rows for this category NOT present in `items` are deactivated.
   */
  async save(
    category: PayrollComponentCategory,
    input: SavePayrollComponentsInput,
  ): Promise<PayrollComponentResponse[]> {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;

    const existing = await this.prisma.client.payrollComponent.findMany({
      where: { category, isActive: true },
    });
    const existingIds = new Set(existing.map((c) => c.id));

    for (const item of input.items) {
      if (item.id && !existingIds.has(item.id)) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: "Payroll component not found",
        });
      }
    }
    this.assertNoDuplicateNames(input.items);
    await this.assertNamesFree(input.items);

    const incomingIds = new Set(input.items.filter((i) => i.id).map((i) => i.id));
    const toDeactivate = existing.filter((c) => !incomingIds.has(c.id));

    return this.prisma.withTenantTx(async (tx) => {
      const saved: PayrollComponentRow[] = [];
      for (const item of input.items) {
        const data = {
          nameEn: item.nameEn,
          nameAr: item.nameAr,
          basis: item.basis,
          defaultAmountMinor:
            item.basis === "fixed_amount" && item.defaultAmountMinor != null
              ? BigInt(item.defaultAmountMinor)
              : null,
          defaultRatePct: item.basis === "percentage_of_base" ? item.defaultRatePct : null,
        };
        saved.push(
          item.id
            ? await tx.payrollComponent.update({ where: { id: item.id }, data })
            : await tx.payrollComponent.create({ data: { ...data, tenantId, category } }),
        );
      }

      if (toDeactivate.length > 0) {
        await tx.payrollComponent.updateMany({
          where: { id: { in: toDeactivate.map((c) => c.id) } },
          data: { isActive: false },
        });
      }

      await this.audit.log(
        {
          action: "payroll_component.saved",
          entityType: "payroll_component",
          entityId: category,
          after: { savedCount: saved.length, deactivatedCount: toDeactivate.length },
        },
        tx,
      );
      return saved.map(toPayrollComponentResponse);
    });
  }

  private assertNoDuplicateNames(items: PayrollComponentListItemInput[]): void {
    const seen = new Set<string>();
    for (const item of items) {
      const key = item.nameEn.trim().toLowerCase();
      if (seen.has(key)) {
        throw new ConflictException({
          code: ERROR_CODES.NAME_EXISTS,
          message: `Duplicate name: ${item.nameEn}`,
        });
      }
      seen.add(key);
    }
  }

  private async assertNamesFree(items: PayrollComponentListItemInput[]): Promise<void> {
    for (const item of items) {
      const clash = await this.prisma.client.payrollComponent.findFirst({
        where: { nameEn: item.nameEn, ...(item.id ? { id: { not: item.id } } : {}) },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException({
          code: ERROR_CODES.NAME_EXISTS,
          message: `A payroll component named "${item.nameEn}" already exists`,
        });
      }
    }
  }
}

function toPayrollComponentResponse(row: PayrollComponentRow): PayrollComponentResponse {
  return {
    id: row.id,
    category: row.category,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    basis: row.basis,
    defaultAmountMinor: row.defaultAmountMinor != null ? Number(row.defaultAmountMinor) : null,
    defaultRatePct: row.defaultRatePct != null ? Number(row.defaultRatePct) : null,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

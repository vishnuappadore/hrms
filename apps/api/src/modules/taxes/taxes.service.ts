import { Injectable, NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import {
  ERROR_CODES,
  type CreateTaxProfileInput,
  type TaxComponent,
  type UpdateTaxProfileInput,
} from "@keystonehr/shared";
import { CLS_KEYS } from "../../common/request-context";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";

/**
 * Tenant-configured tax schemes. Single source for every consumer:
 * POS calculation, invoicing, bill display, reports. Consumers call
 * getComponentsForBranch() and feed the result to computeInvoiceTotals()
 * from @keystonehr/shared — never a literal rate in feature code.
 */
@Injectable()
export class TaxesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
  ) {}

  list() {
    return this.prisma.client.taxProfile.findMany({
      include: { components: { orderBy: { sortOrder: "asc" } } },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
  }

  async getById(id: string) {
    const profile = await this.prisma.client.taxProfile.findUnique({
      where: { id },
      include: { components: { orderBy: { sortOrder: "asc" } } },
    });
    if (!profile) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Tax profile not found" });
    }
    return profile;
  }

  /** The tenant's default profile (inherited by branches created without one). */
  async getDefault() {
    const profile = await this.prisma.client.taxProfile.findFirst({
      where: { isDefault: true },
      include: { components: { orderBy: { sortOrder: "asc" } } },
    });
    return profile;
  }

  /**
   * The components applicable at a branch, ready for computeInvoiceTotals().
   * Empty array = tax-free branch.
   */
  async getComponentsForBranch(branchId: string): Promise<TaxComponent[]> {
    const branch = await this.prisma.client.branch.findUnique({
      where: { id: branchId },
      select: {
        taxProfile: {
          select: { components: { orderBy: { sortOrder: "asc" } } },
        },
      },
    });
    return (branch?.taxProfile?.components ?? []).map((c) => ({
      name: c.name,
      ratePercent: Number(c.ratePercent),
    }));
  }

  async create(input: CreateTaxProfileInput) {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    return this.prisma.withTenantTx(async (tx) => {
      if (input.isDefault) {
        await tx.taxProfile.updateMany({ data: { isDefault: false }, where: { isDefault: true } });
      }
      const profile = await tx.taxProfile.create({
        data: {
          tenantId,
          name: input.name,
          country: input.country ?? null,
          isDefault: input.isDefault,
          components: {
            create: input.components.map((c, i) => ({
              tenantId,
              name: c.name,
              ratePercent: c.ratePercent,
              sortOrder: i,
            })),
          },
        },
        include: { components: { orderBy: { sortOrder: "asc" } } },
      });
      await this.audit.log(
        { action: "tax_profile.created", entityType: "tax_profile", entityId: profile.id, after: profile },
        tx,
      );
      return profile;
    });
  }

  async update(id: string, input: UpdateTaxProfileInput) {
    const before = await this.getById(id);
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    return this.prisma.withTenantTx(async (tx) => {
      if (input.isDefault) {
        await tx.taxProfile.updateMany({ data: { isDefault: false }, where: { isDefault: true } });
      }
      const profile = await tx.taxProfile.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.country !== undefined ? { country: input.country } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          // components are replaced wholesale — invoices snapshot their own
          // breakdown at sale time, so history is unaffected
          ...(input.components
            ? {
                components: {
                  deleteMany: {},
                  create: input.components.map((c, i) => ({
                    tenantId,
                    name: c.name,
                    ratePercent: c.ratePercent,
                    sortOrder: i,
                  })),
                },
              }
            : {}),
        },
        include: { components: { orderBy: { sortOrder: "asc" } } },
      });
      await this.audit.log(
        { action: "tax_profile.updated", entityType: "tax_profile", entityId: id, before, after: profile },
        tx,
      );
      return profile;
    });
  }
}

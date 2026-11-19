import { ConflictException, Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { ERROR_CODES, type GeneralSettings, type UpdateGeneralSettingsInput } from "@keystonehr/shared";
import { CLS_KEYS } from "../../common/request-context";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class GeneralSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
  ) {}

  async get(): Promise<GeneralSettings> {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const [tenant, branchCount] = await Promise.all([
      this.prisma.client.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      this.prisma.client.branch.count({ where: { tenantId } }),
    ]);
    return {
      defaultLocale: tenant.defaultLocale,
      timezone: tenant.timezone,
      defaultCurrency: tenant.defaultCurrency,
      useWesternNumeralsInArabic: tenant.useWesternNumeralsInArabic,
      weekStartsOn: tenant.weekStartsOn as GeneralSettings["weekStartsOn"],
      branchCount,
    };
  }

  async update(input: UpdateGeneralSettingsInput): Promise<GeneralSettings> {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    await this.prisma.withTenantTx(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      if (input.defaultCurrency !== tenant.defaultCurrency) {
        const branchCount = await tx.branch.count({ where: { tenantId } });
        if (branchCount > 0) {
          throw new ConflictException({
            code: ERROR_CODES.TENANT_CURRENCY_LOCKED,
            message:
              "Default currency can't change once a branch exists — branches already inherited the prior default",
          });
        }
      }
      const updated = await tx.tenant.update({ where: { id: tenantId }, data: input });
      await this.audit.log(
        {
          action: "general_settings.updated",
          entityType: "tenant",
          entityId: tenantId,
          after: { ...input },
        },
        tx,
      );
      return updated;
    });
    return this.get();
  }
}

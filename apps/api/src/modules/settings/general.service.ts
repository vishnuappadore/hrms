import { Injectable } from "@nestjs/common";
import type { GeneralSettings, UpdateGeneralSettingsInput } from "@keystonehr/shared";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";

const COMPANY_SETTINGS_ID = "default";

@Injectable()
export class GeneralSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<GeneralSettings> {
    const [company, branchCount] = await Promise.all([
      this.prisma.client.companySettings.findUniqueOrThrow({ where: { id: COMPANY_SETTINGS_ID } }),
      this.prisma.client.branch.count(),
    ]);
    return {
      defaultLocale: company.defaultLocale,
      timezone: company.timezone,
      defaultCurrency: company.defaultCurrency,
      useWesternNumeralsInArabic: company.useWesternNumeralsInArabic,
      weekStartsOn: company.weekStartsOn as GeneralSettings["weekStartsOn"],
      branchCount,
    };
  }

  async update(input: UpdateGeneralSettingsInput): Promise<GeneralSettings> {
    await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.companySettings.update({
        where: { id: COMPANY_SETTINGS_ID },
        data: input,
      });
      await this.audit.log(
        {
          action: "general_settings.updated",
          entityType: "company_settings",
          entityId: COMPANY_SETTINGS_ID,
          after: { ...input },
        },
        tx,
      );
      return updated;
    });
    return this.get();
  }
}

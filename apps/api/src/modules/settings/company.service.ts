import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { CompanySettings as CompanySettingsRow } from "@prisma/client";
import type {
  CompanySettings,
  PresignCompanyLogoInput,
  PresignedCompanyLogoUpload,
  UpdateCompanySettingsInput,
} from "@keystonehr/shared";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";

const COMPANY_SETTINGS_ID = "default";

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async get(): Promise<CompanySettings> {
    const company = await this.prisma.client.companySettings.findUniqueOrThrow({
      where: { id: COMPANY_SETTINGS_ID },
    });
    return this.toResponse(company);
  }

  async update(input: UpdateCompanySettingsInput): Promise<CompanySettings> {
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.companySettings.update({
        where: { id: COMPANY_SETTINGS_ID },
        data: input,
      });
      await this.audit.log(
        {
          action: "company_settings.updated",
          entityType: "company_settings",
          entityId: COMPANY_SETTINGS_ID,
          after: { name: updated.name },
        },
        tx,
      );
      return updated;
    });
    return this.toResponse(updated);
  }

  async presignLogoUpload(input: PresignCompanyLogoInput): Promise<PresignedCompanyLogoUpload> {
    const key = `company/company-logo/${randomUUID()}-${input.fileName}`;
    const uploadUrl = await this.storage.getUploadUrl(key, input.contentType);
    return { uploadUrl, key };
  }

  private async toResponse(company: CompanySettingsRow): Promise<CompanySettings> {
    return {
      name: company.name,
      contactPhone: company.contactPhone,
      contactEmail: company.contactEmail,
      address: company.address,
      taxNumber: company.taxNumber,
      commercialRegistrationNo: company.commercialRegistrationNo,
      logoUrl: company.logoKey ? await this.storage.getDownloadUrl(company.logoKey) : null,
    };
  }
}

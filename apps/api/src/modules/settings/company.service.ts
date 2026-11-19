import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import type { Tenant } from "@prisma/client";
import type {
  CompanySettings,
  PresignCompanyLogoInput,
  PresignedCompanyLogoUpload,
  UpdateCompanySettingsInput,
} from "@keystonehr/shared";
import { CLS_KEYS } from "../../common/request-context";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
    private readonly storage: StorageService,
  ) {}

  async get(): Promise<CompanySettings> {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const tenant = await this.prisma.client.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    return this.toResponse(tenant);
  }

  async update(input: UpdateCompanySettingsInput): Promise<CompanySettings> {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const updated = await this.prisma.withTenantTx(async (tx) => {
      const updated = await tx.tenant.update({ where: { id: tenantId }, data: input });
      await this.audit.log(
        {
          action: "company_settings.updated",
          entityType: "tenant",
          entityId: tenantId,
          after: { name: updated.name },
        },
        tx,
      );
      return updated;
    });
    return this.toResponse(updated);
  }

  async presignLogoUpload(input: PresignCompanyLogoInput): Promise<PresignedCompanyLogoUpload> {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const key = `tenants/${tenantId}/company-logo/${randomUUID()}-${input.fileName}`;
    const uploadUrl = await this.storage.getUploadUrl(key, input.contentType);
    return { uploadUrl, key };
  }

  private async toResponse(tenant: Tenant): Promise<CompanySettings> {
    return {
      name: tenant.name,
      contactPhone: tenant.contactPhone,
      contactEmail: tenant.contactEmail,
      address: tenant.address,
      taxNumber: tenant.taxNumber,
      commercialRegistrationNo: tenant.commercialRegistrationNo,
      logoUrl: tenant.logoKey ? await this.storage.getDownloadUrl(tenant.logoKey) : null,
    };
  }
}

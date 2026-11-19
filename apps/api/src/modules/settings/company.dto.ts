import { createZodDto } from "nestjs-zod";
import { PresignCompanyLogoSchema, UpdateCompanySettingsSchema } from "@keystonehr/shared";

export class UpdateCompanySettingsDto extends createZodDto(UpdateCompanySettingsSchema) {}
export class PresignCompanyLogoDto extends createZodDto(PresignCompanyLogoSchema) {}

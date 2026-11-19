import { z } from "zod";

/**
 * Settings > Company Info — the company profile shown on payslips and
 * printed documents. Backed by the single `CompanySettings` row.
 */

export const UpdateCompanySettingsSchema = z.object({
  name: z.string().min(2).max(150),
  contactPhone: z.string().max(30).nullable().optional(),
  contactEmail: z.string().email().max(150).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  taxNumber: z.string().max(100).nullable().optional(),
  commercialRegistrationNo: z.string().max(100).nullable().optional(),
  /** Set via the logo-upload-url flow, not typed directly by the form. */
  logoKey: z.string().nullable().optional(),
});
export type UpdateCompanySettingsInput = z.infer<typeof UpdateCompanySettingsSchema>;

export const CompanySettingsSchema = z.object({
  name: z.string(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  address: z.string().nullable(),
  taxNumber: z.string().nullable(),
  commercialRegistrationNo: z.string().nullable(),
  /** Presigned GET URL for the current logo, regenerated on each read. */
  logoUrl: z.string().nullable(),
});
export type CompanySettings = z.infer<typeof CompanySettingsSchema>;

/** Mirrors PresignLeaveAttachmentSchema/PresignedUploadSchema (./leave.ts) — same upload flow. */
export const PresignCompanyLogoSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
});
export type PresignCompanyLogoInput = z.infer<typeof PresignCompanyLogoSchema>;

export const PresignedCompanyLogoUploadSchema = z.object({
  uploadUrl: z.string().url(),
  key: z.string(),
});
export type PresignedCompanyLogoUpload = z.infer<typeof PresignedCompanyLogoUploadSchema>;

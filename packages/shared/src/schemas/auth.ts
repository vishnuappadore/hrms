import { z } from "zod";

export const LoginSchema = z.object({
  /** Email or username — the login screen accepts either. */
  identifier: z.string().min(1, "Please enter your email or username").max(255),
  password: z.string().min(1, "Please enter your password").max(255),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof RefreshSchema>;

export const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters").max(255),
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** access-token TTL in seconds, for client-side refresh scheduling */
  expiresIn: z.number(),
});
export type AuthTokens = z.infer<typeof AuthTokensSchema>;

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  email: z.string().email().nullable(),
  username: z.string(),
  roleId: z.string().uuid(),
  roleNameEn: z.string(),
  roleNameAr: z.string(),
  /** The role's permission keys — for client-side UI hiding only, never a security boundary
   *  (the API's own @Permissions() guards are what actually enforce access). */
  permissions: z.array(z.string()),
  allBranches: z.boolean(),
  branchIds: z.array(z.string().uuid()),
  locale: z.enum(["en", "ar"]),
  /** tenant default currency (ISO 4217) — catalog prices are entered in it */
  currency: z.string(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

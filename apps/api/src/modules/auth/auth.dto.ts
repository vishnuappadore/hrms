import { createZodDto } from "nestjs-zod";
import {
  ForgotPasswordSchema,
  LoginSchema,
  RefreshSchema,
  ResetPasswordSchema,
} from "@keystonehr/shared";

export class LoginDto extends createZodDto(LoginSchema) {}
export class RefreshDto extends createZodDto(RefreshSchema) {}
export class ForgotPasswordDto extends createZodDto(ForgotPasswordSchema) {}
export class ResetPasswordDto extends createZodDto(ResetPasswordSchema) {}

import { createZodDto } from "nestjs-zod";
import {
  CreateStaffSchema,
  ListUsersQuerySchema,
  ResetUserPasswordSchema,
  UpdateStaffSchema,
} from "@keystonehr/shared";

export class CreateUserDto extends createZodDto(CreateStaffSchema) {}
export class UpdateUserDto extends createZodDto(UpdateStaffSchema) {}
export class ResetUserPasswordDto extends createZodDto(ResetUserPasswordSchema) {}
export class ListUsersQueryDto extends createZodDto(ListUsersQuerySchema) {}

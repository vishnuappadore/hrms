import { createZodDto } from "nestjs-zod";
import {
  CreateEmployeeSchema,
  ListUsersQuerySchema,
  ResetUserPasswordSchema,
  UpdateEmployeeSchema,
} from "@keystonehr/shared";

export class CreateEmployeeDto extends createZodDto(CreateEmployeeSchema) {}
export class UpdateEmployeeDto extends createZodDto(UpdateEmployeeSchema) {}
export class ResetEmployeePasswordDto extends createZodDto(ResetUserPasswordSchema) {}
export class ListEmployeesQueryDto extends createZodDto(ListUsersQuerySchema) {}

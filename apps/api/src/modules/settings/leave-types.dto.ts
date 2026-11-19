import { createZodDto } from "nestjs-zod";
import { CreateLeaveTypeSchema, ListLeaveTypesQuerySchema, UpdateLeaveTypeSchema } from "@keystonehr/shared";

export class CreateLeaveTypeDto extends createZodDto(CreateLeaveTypeSchema) {}
export class UpdateLeaveTypeDto extends createZodDto(UpdateLeaveTypeSchema) {}
export class ListLeaveTypesQueryDto extends createZodDto(ListLeaveTypesQuerySchema) {}

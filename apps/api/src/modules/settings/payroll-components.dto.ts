import { createZodDto } from "nestjs-zod";
import { ListPayrollComponentsQuerySchema, SavePayrollComponentsSchema } from "@keystonehr/shared";

export class ListPayrollComponentsQueryDto extends createZodDto(ListPayrollComponentsQuerySchema) {}
export class SavePayrollComponentsDto extends createZodDto(SavePayrollComponentsSchema) {}

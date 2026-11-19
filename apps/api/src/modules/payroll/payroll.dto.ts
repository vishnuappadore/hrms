import { createZodDto } from "nestjs-zod";
import {
  BulkPayrollActionSchema,
  EditPayrollItemSchema,
  GeneratePayrollRunSchema,
  GetPayrollRunQuerySchema,
  ListPayrollBatchesQuerySchema,
  ListPayrollBatchItemsQuerySchema,
  ListPayrollItemsQuerySchema,
  RejectPayrollItemSchema,
} from "@keystonehr/shared";

export class GeneratePayrollRunDto extends createZodDto(GeneratePayrollRunSchema) {}
export class GetPayrollRunQueryDto extends createZodDto(GetPayrollRunQuerySchema) {}
export class ListPayrollItemsQueryDto extends createZodDto(ListPayrollItemsQuerySchema) {}
export class ListPayrollBatchesQueryDto extends createZodDto(ListPayrollBatchesQuerySchema) {}
export class ListPayrollBatchItemsQueryDto extends createZodDto(ListPayrollBatchItemsQuerySchema) {}
export class EditPayrollItemDto extends createZodDto(EditPayrollItemSchema) {}
export class RejectPayrollItemDto extends createZodDto(RejectPayrollItemSchema) {}
export class BulkPayrollActionDto extends createZodDto(BulkPayrollActionSchema) {}

import { createZodDto } from "nestjs-zod";
import { CheckoutSchema, ListInvoicesQuerySchema } from "@keystonehr/shared";

export class CheckoutDto extends createZodDto(CheckoutSchema) {}
export class ListInvoicesQueryDto extends createZodDto(ListInvoicesQuerySchema) {}

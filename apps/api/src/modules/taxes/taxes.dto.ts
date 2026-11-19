import { createZodDto } from "nestjs-zod";
import { CreateTaxProfileSchema, UpdateTaxProfileSchema } from "@keystonehr/shared";

export class CreateTaxProfileDto extends createZodDto(CreateTaxProfileSchema) {}
export class UpdateTaxProfileDto extends createZodDto(UpdateTaxProfileSchema) {}

import { createZodDto } from "nestjs-zod";
import {
  CreateServiceCategorySchema,
  CreateServiceSchema,
  ListServicesQuerySchema,
  UpdateServiceCategorySchema,
  UpdateServiceSchema,
} from "@keystonehr/shared";

export class CreateServiceCategoryDto extends createZodDto(CreateServiceCategorySchema) {}
export class UpdateServiceCategoryDto extends createZodDto(UpdateServiceCategorySchema) {}
export class CreateServiceDto extends createZodDto(CreateServiceSchema) {}
export class UpdateServiceDto extends createZodDto(UpdateServiceSchema) {}
export class ListServicesQueryDto extends createZodDto(ListServicesQuerySchema) {}

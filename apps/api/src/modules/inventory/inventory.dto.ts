import { createZodDto } from "nestjs-zod";
import {
  AdjustStockSchema,
  CreateProductSchema,
  ListProductsQuerySchema,
  UpdateProductSchema,
} from "@keystonehr/shared";

export class CreateProductDto extends createZodDto(CreateProductSchema) {}
export class UpdateProductDto extends createZodDto(UpdateProductSchema) {}
export class ListProductsQueryDto extends createZodDto(ListProductsQuerySchema) {}
export class AdjustStockDto extends createZodDto(AdjustStockSchema) {}

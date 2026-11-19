import { createZodDto } from "nestjs-zod";
import {
  CreateCustomerSchema,
  ListCustomersQuerySchema,
  PresignCustomerPhotoSchema,
  UpdateCustomerSchema,
} from "@keystonehr/shared";

export class CreateCustomerDto extends createZodDto(CreateCustomerSchema) {}
export class UpdateCustomerDto extends createZodDto(UpdateCustomerSchema) {}
export class ListCustomersQueryDto extends createZodDto(ListCustomersQuerySchema) {}
export class PresignCustomerPhotoDto extends createZodDto(PresignCustomerPhotoSchema) {}

import { createZodDto } from "nestjs-zod";
import {
  AssignWalkInBarberSchema,
  CreateWalkInSchema,
  ListWalkInsQuerySchema,
  UpdateWalkInSchema,
} from "@keystonehr/shared";

export class CreateWalkInDto extends createZodDto(CreateWalkInSchema) {}
export class ListWalkInsQueryDto extends createZodDto(ListWalkInsQuerySchema) {}
export class AssignWalkInBarberDto extends createZodDto(AssignWalkInBarberSchema) {}
export class UpdateWalkInDto extends createZodDto(UpdateWalkInSchema) {}

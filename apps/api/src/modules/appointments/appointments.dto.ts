import { createZodDto } from "nestjs-zod";
import {
  CreateAppointmentSchema,
  ListAppointmentsQuerySchema,
  ListBarbersQuerySchema,
  ListSlotsQuerySchema,
  UpdateAppointmentSchema,
} from "@keystonehr/shared";

export class CreateAppointmentDto extends createZodDto(CreateAppointmentSchema) {}
export class UpdateAppointmentDto extends createZodDto(UpdateAppointmentSchema) {}
export class ListAppointmentsQueryDto extends createZodDto(ListAppointmentsQuerySchema) {}
export class ListBarbersQueryDto extends createZodDto(ListBarbersQuerySchema) {}
export class ListSlotsQueryDto extends createZodDto(ListSlotsQuerySchema) {}

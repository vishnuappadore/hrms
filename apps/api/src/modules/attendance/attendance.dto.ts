import { createZodDto } from "nestjs-zod";
import { AttendanceKpisQuerySchema, ListAttendanceQuerySchema, UpdateAttendanceDaySchema } from "@keystonehr/shared";

export class ListAttendanceQueryDto extends createZodDto(ListAttendanceQuerySchema) {}
export class AttendanceKpisQueryDto extends createZodDto(AttendanceKpisQuerySchema) {}
export class UpdateAttendanceDayDto extends createZodDto(UpdateAttendanceDaySchema) {}

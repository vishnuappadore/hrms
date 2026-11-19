import { createZodDto } from "nestjs-zod";
import {
  CancelLeaveRequestSchema,
  CreateLeaveRequestSchema,
  LeaveKpisQuerySchema,
  ListLeaveRequestsQuerySchema,
  ListMyLeaveRequestsQuerySchema,
  PresignLeaveAttachmentSchema,
  RejectLeaveRequestSchema,
} from "@keystonehr/shared";

export class CreateLeaveRequestDto extends createZodDto(CreateLeaveRequestSchema) {}
export class ListLeaveRequestsQueryDto extends createZodDto(ListLeaveRequestsQuerySchema) {}
export class ListMyLeaveRequestsQueryDto extends createZodDto(ListMyLeaveRequestsQuerySchema) {}
export class RejectLeaveRequestDto extends createZodDto(RejectLeaveRequestSchema) {}
export class CancelLeaveRequestDto extends createZodDto(CancelLeaveRequestSchema) {}
export class LeaveKpisQueryDto extends createZodDto(LeaveKpisQuerySchema) {}
export class PresignLeaveAttachmentDto extends createZodDto(PresignLeaveAttachmentSchema) {}

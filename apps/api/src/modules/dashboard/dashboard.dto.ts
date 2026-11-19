import { createZodDto } from "nestjs-zod";
import { DashboardQuerySchema } from "@keystonehr/shared";

export class DashboardQueryDto extends createZodDto(DashboardQuerySchema) {}

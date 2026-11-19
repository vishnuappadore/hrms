import { createZodDto } from "nestjs-zod";
import { UpdateGeneralSettingsSchema } from "@keystonehr/shared";

export class UpdateGeneralSettingsDto extends createZodDto(UpdateGeneralSettingsSchema) {}

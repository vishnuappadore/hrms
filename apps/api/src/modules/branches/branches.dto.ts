import { createZodDto } from "nestjs-zod";
import { CreateBranchSchema, ListBranchesQuerySchema, UpdateBranchSchema } from "@keystonehr/shared";

export class CreateBranchDto extends createZodDto(CreateBranchSchema) {}
export class UpdateBranchDto extends createZodDto(UpdateBranchSchema) {}
export class ListBranchesQueryDto extends createZodDto(ListBranchesQuerySchema) {}

import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { Permissions } from "../../common/decorators";
import { TaxesService } from "./taxes.service";
import { CreateTaxProfileDto, UpdateTaxProfileDto } from "./taxes.dto";

@Controller("tax-profiles")
export class TaxesController {
  constructor(private readonly taxes: TaxesService) {}

  @Get()
  @Permissions("taxes.view")
  async list(@Query("default") defaultOnly?: string) {
    if (defaultOnly === "true") {
      const profile = await this.taxes.getDefault();
      return { data: profile ? [profile] : [] };
    }
    return { data: await this.taxes.list() };
  }

  @Get(":id")
  @Permissions("taxes.view")
  getById(@Param("id") id: string) {
    return this.taxes.getById(id);
  }

  @Post()
  @Permissions("taxes.manage")
  create(@Body() dto: CreateTaxProfileDto) {
    return this.taxes.create(dto);
  }

  @Patch(":id")
  @Permissions("taxes.manage")
  update(@Param("id") id: string, @Body() dto: UpdateTaxProfileDto) {
    return this.taxes.update(id, dto);
  }
}

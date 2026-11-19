import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { Permissions } from "../../common/decorators";
import { ServicesService } from "./services.service";
import { CreateServiceDto, ListServicesQueryDto, UpdateServiceDto } from "./services.dto";

@Controller("services")
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  @Permissions("services.view")
  list(@Query() query: ListServicesQueryDto) {
    return this.services.list(query);
  }

  @Get(":serviceId")
  @Permissions("services.view")
  getById(@Param("serviceId") serviceId: string) {
    return this.services.getById(serviceId);
  }

  @Post()
  @Permissions("services.manage")
  create(@Body() dto: CreateServiceDto) {
    return this.services.create(dto);
  }

  @Patch(":serviceId")
  @Permissions("services.manage")
  update(@Param("serviceId") serviceId: string, @Body() dto: UpdateServiceDto) {
    return this.services.update(serviceId, dto);
  }
}

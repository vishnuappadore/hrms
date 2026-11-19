import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { Permissions } from "../../common/decorators";
import { ServicesService } from "./services.service";
import { CreateServiceCategoryDto, UpdateServiceCategoryDto } from "./services.dto";

@Controller("service-categories")
export class ServiceCategoriesController {
  constructor(private readonly services: ServicesService) {}

  /** Small, ordered set — returned whole (no pagination) for pickers and tabs. */
  @Get()
  @Permissions("services.view")
  list() {
    return this.services.listCategories();
  }

  @Post()
  @Permissions("services.manage")
  create(@Body() dto: CreateServiceCategoryDto) {
    return this.services.createCategory(dto);
  }

  @Patch(":categoryId")
  @Permissions("services.manage")
  update(@Param("categoryId") categoryId: string, @Body() dto: UpdateServiceCategoryDto) {
    return this.services.updateCategory(categoryId, dto);
  }
}

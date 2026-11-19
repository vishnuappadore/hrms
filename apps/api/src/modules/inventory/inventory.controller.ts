import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { Permissions } from "../../common/decorators";
import { InventoryService } from "./inventory.service";
import {
  AdjustStockDto,
  CreateProductDto,
  ListProductsQueryDto,
  UpdateProductDto,
} from "./inventory.dto";

@Controller("products")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @Permissions("inventory.view")
  list(@Query() query: ListProductsQueryDto) {
    return this.inventory.list(query);
  }

  @Get(":productId")
  @Permissions("inventory.view")
  getById(@Param("productId") productId: string, @Query("branchId") branchId?: string) {
    return this.inventory.getById(productId, branchId);
  }

  @Post()
  @Permissions("inventory.manage")
  create(@Body() dto: CreateProductDto) {
    return this.inventory.create(dto);
  }

  @Patch(":productId")
  @Permissions("inventory.manage")
  update(@Param("productId") productId: string, @Body() dto: UpdateProductDto) {
    return this.inventory.update(productId, dto);
  }

  @Post(":productId/adjust-stock")
  @Permissions("inventory.manage")
  adjustStock(@Param("productId") productId: string, @Body() dto: AdjustStockDto) {
    return this.inventory.adjustStock(productId, dto);
  }
}

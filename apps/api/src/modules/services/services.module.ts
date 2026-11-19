import { Module } from "@nestjs/common";
import { ServiceCategoriesController } from "./service-categories.controller";
import { ServicesController } from "./services.controller";
import { ServicesService } from "./services.service";

@Module({
  controllers: [ServicesController, ServiceCategoriesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}

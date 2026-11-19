import { Module } from "@nestjs/common";
import { RolesController } from "./roles.controller";
import { RolesService } from "./roles.service";
import { EmployeesController } from "./employees.controller";
import { EmployeesService } from "./employees.service";

@Module({
  controllers: [EmployeesController, RolesController],
  providers: [EmployeesService, RolesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}

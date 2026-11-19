import { Module } from "@nestjs/common";
import { LeaveModule } from "../leave/leave.module";
import { StorageModule } from "../storage/storage.module";
import { PayrollComponentsController } from "./payroll-components.controller";
import { PayrollComponentsService } from "./payroll-components.service";
import { LeaveTypesController } from "./leave-types.controller";
import { LeaveTypesService } from "./leave-types.service";
import { CompanyController } from "./company.controller";
import { CompanyService } from "./company.service";
import { GeneralSettingsController } from "./general.controller";
import { GeneralSettingsService } from "./general.service";

@Module({
  imports: [LeaveModule, StorageModule],
  controllers: [
    PayrollComponentsController,
    LeaveTypesController,
    CompanyController,
    GeneralSettingsController,
  ],
  providers: [PayrollComponentsService, LeaveTypesService, CompanyService, GeneralSettingsService],
  exports: [PayrollComponentsService, LeaveTypesService, CompanyService, GeneralSettingsService],
})
export class SettingsModule {}

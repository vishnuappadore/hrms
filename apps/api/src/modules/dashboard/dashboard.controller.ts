import { Controller, Get, Query } from "@nestjs/common";
import { BranchScoped, Permissions } from "../../common/decorators";
import { DashboardService } from "./dashboard.service";
import { DashboardQueryDto } from "./dashboard.dto";

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @Permissions("dashboard.view")
  @BranchScoped("branchId")
  get(@Query() query: DashboardQueryDto) {
    return this.dashboard.get(query);
  }
}

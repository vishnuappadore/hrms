import { BadRequestException, Body, Controller, Get, Put, Query } from "@nestjs/common";
import { ERROR_CODES } from "@keystonehr/shared";
import { Permissions } from "../../common/decorators";
import { PayrollComponentsService } from "./payroll-components.service";
import { ListPayrollComponentsQueryDto, SavePayrollComponentsDto } from "./payroll-components.dto";

@Controller("payroll-components")
export class PayrollComponentsController {
  constructor(private readonly payrollComponents: PayrollComponentsService) {}

  /** Readable by anyone who can open the Add Staff form, not just settings admins. */
  @Get()
  @Permissions("staff.view")
  list(@Query() query: ListPayrollComponentsQueryDto) {
    return this.payrollComponents.list(query.category);
  }

  /** One bulk call per section — replaces the full active set for `category`. */
  @Put()
  @Permissions("settings.manage")
  save(@Query() query: ListPayrollComponentsQueryDto, @Body() dto: SavePayrollComponentsDto) {
    if (!query.category) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "category is required",
      });
    }
    return this.payrollComponents.save(query.category, dto);
  }
}

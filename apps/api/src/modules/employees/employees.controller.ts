import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser, Permissions } from "../../common/decorators";
import type { RequestContext } from "../../common/request-context";
import { EmployeesService } from "./employees.service";
import {
  CreateEmployeeDto,
  ListEmployeesQueryDto,
  ResetEmployeePasswordDto,
  UpdateEmployeeDto,
} from "./employees.dto";

@Controller("employees")
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  /** The authenticated user's own profile — used by the web shell on load. */
  @Get("me")
  me(@CurrentUser() ctx: RequestContext) {
    return this.employees.getMe(ctx.userId);
  }

  @Get()
  @Permissions("employee.view")
  list(@Query() query: ListEmployeesQueryDto) {
    return this.employees.list(query);
  }

  @Get(":userId")
  @Permissions("employee.view")
  getById(@Param("userId") userId: string) {
    return this.employees.getById(userId);
  }

  /** Also requires employee.employment.manage — this payload now carries salary/commission. */
  @Post()
  @Permissions("employee.create", "employee.employment.manage")
  create(@Body() dto: CreateEmployeeDto) {
    return this.employees.create(dto);
  }

  @Patch(":userId")
  @Permissions("employee.update", "employee.employment.manage")
  update(@Param("userId") userId: string, @Body() dto: UpdateEmployeeDto) {
    return this.employees.update(userId, dto);
  }

  @Post(":userId/reset-password")
  @Permissions("employee.update")
  resetPassword(@Param("userId") userId: string, @Body() dto: ResetEmployeePasswordDto) {
    return this.employees.resetPassword(userId, dto.password);
  }
}

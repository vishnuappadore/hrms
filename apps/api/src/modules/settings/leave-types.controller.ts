import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { Permissions } from "../../common/decorators";
import { LeaveTypesService } from "./leave-types.service";
import { CreateLeaveTypeDto, ListLeaveTypesQueryDto, UpdateLeaveTypeDto } from "./leave-types.dto";

@Controller("leave-types")
export class LeaveTypesController {
  constructor(private readonly leaveTypes: LeaveTypesService) {}

  /** Readable by anyone who can request leave, not just settings admins. */
  @Get()
  @Permissions("leave.request")
  list(@Query() query: ListLeaveTypesQueryDto) {
    return this.leaveTypes.list(query.includeInactive);
  }

  @Post()
  @Permissions("leave.settings.manage")
  create(@Body() dto: CreateLeaveTypeDto) {
    return this.leaveTypes.create(dto);
  }

  /** No delete endpoint — deactivate via { isActive: false }, same as Payroll Components. */
  @Patch(":id")
  @Permissions("leave.settings.manage")
  update(@Param("id") id: string, @Body() dto: UpdateLeaveTypeDto) {
    return this.leaveTypes.update(id, dto);
  }
}

import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Permissions } from "../../common/decorators";
import { LeaveService } from "./leave.service";
import {
  CancelLeaveRequestDto,
  CreateLeaveRequestDto,
  LeaveKpisQueryDto,
  ListLeaveRequestsQueryDto,
  ListMyLeaveRequestsQueryDto,
  PresignLeaveAttachmentDto,
  RejectLeaveRequestDto,
} from "./leave.dto";

@Controller("leave")
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  // Static segments before :employeeProfileId / :id routes (same NestJS route-order gotcha as Attendance).
  @Get("balances/me")
  @Permissions("leave.request")
  getMyBalances() {
    return this.leave.getMyBalances();
  }

  @Get("kpis")
  @Permissions("leave.view")
  getKpis(@Query() query: LeaveKpisQueryDto) {
    return this.leave.getKpis(query);
  }

  @Get("balances/:employeeProfileId")
  @Permissions("leave.view")
  getBalances(@Param("employeeProfileId") employeeProfileId: string) {
    return this.leave.getBalancesFor(employeeProfileId);
  }

  @Post("attachments/presign-upload")
  @Permissions("leave.request")
  presignUpload(@Body() dto: PresignLeaveAttachmentDto) {
    return this.leave.presignUpload(dto);
  }

  @Post("requests")
  @Permissions("leave.request")
  create(@Body() dto: CreateLeaveRequestDto) {
    return this.leave.create(dto);
  }

  @Get("requests")
  @Permissions("leave.view")
  list(@Query() query: ListLeaveRequestsQueryDto) {
    return this.leave.list(query);
  }

  @Get("requests/me")
  @Permissions("leave.request")
  listMine(@Query() query: ListMyLeaveRequestsQueryDto) {
    return this.leave.listMine(query);
  }

  @Get("requests/:id")
  @Permissions("leave.view")
  getDetail(@Param("id") id: string) {
    return this.leave.getDetail(id);
  }

  @Get("requests/:id/attachment-url")
  @Permissions("leave.view")
  getAttachmentUrl(@Param("id") id: string) {
    return this.leave.getAttachmentUrl(id);
  }

  @Post("requests/:id/approve")
  @Permissions("leave.approve")
  approve(@Param("id") id: string) {
    return this.leave.approve(id);
  }

  @Post("requests/:id/reject")
  @Permissions("leave.approve")
  reject(@Param("id") id: string, @Body() dto: RejectLeaveRequestDto) {
    return this.leave.reject(id, dto);
  }

  @Post("requests/:id/cancel")
  @Permissions("leave.approve")
  cancel(@Param("id") id: string, @Body() dto: CancelLeaveRequestDto) {
    return this.leave.cancel(id, dto);
  }

  @Post("requests/:id/withdraw")
  @Permissions("leave.request")
  withdraw(@Param("id") id: string) {
    return this.leave.withdraw(id);
  }
}

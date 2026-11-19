import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { Permissions } from "../../common/decorators";
import { AttendanceService } from "./attendance.service";
import { AttendanceKpisQueryDto, ListAttendanceQueryDto, UpdateAttendanceDayDto } from "./attendance.dto";

@Controller("attendance")
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  /** Self-service — every employee, not gated by a management permission. */
  @Post("check-in")
  @Permissions("attendance.mark")
  checkIn() {
    return this.attendance.checkIn();
  }

  @Post("check-out")
  @Permissions("attendance.mark")
  checkOut() {
    return this.attendance.checkOut();
  }

  /** Viewing your own already-recorded attendance needs no permission, same as GET /employees/me. */
  @Get("me/today")
  getMyToday() {
    return this.attendance.getMyToday();
  }

  // Static segments before :employeeProfileId routes (NestJS route-order gotcha).
  @Get("kpis")
  @Permissions("attendance.view")
  getKpis(@Query() query: AttendanceKpisQueryDto) {
    return this.attendance.getKpis(query);
  }

  @Get(":employeeProfileId/monthly")
  @Permissions("attendance.view")
  getMonthlyDetail(@Param("employeeProfileId") employeeProfileId: string, @Query("month") month: string) {
    return this.attendance.getMonthlyDetail(employeeProfileId, month);
  }

  @Get(":employeeProfileId/days/:date")
  @Permissions("attendance.view")
  getDayDetail(@Param("employeeProfileId") employeeProfileId: string, @Param("date") date: string) {
    return this.attendance.getDayDetail(employeeProfileId, date);
  }

  @Patch(":employeeProfileId/days/:date")
  @Permissions("attendance.edit")
  updateDay(
    @Param("employeeProfileId") employeeProfileId: string,
    @Param("date") date: string,
    @Body() dto: UpdateAttendanceDayDto,
  ) {
    return this.attendance.updateDay(employeeProfileId, date, dto);
  }

  @Get()
  @Permissions("attendance.view")
  list(@Query() query: ListAttendanceQueryDto) {
    return this.attendance.list(query);
  }
}

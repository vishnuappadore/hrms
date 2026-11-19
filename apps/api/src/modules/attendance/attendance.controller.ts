import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { Permissions } from "../../common/decorators";
import { AttendanceService } from "./attendance.service";
import { AttendanceKpisQueryDto, ListAttendanceQueryDto, UpdateAttendanceDayDto } from "./attendance.dto";

@Controller("attendance")
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  /** Self-service — every staff member, not gated by a management permission. */
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

  /** Viewing your own already-recorded attendance needs no permission, same as GET /users/me. */
  @Get("me/today")
  getMyToday() {
    return this.attendance.getMyToday();
  }

  // Static segments before :staffProfileId routes (NestJS route-order gotcha).
  @Get("kpis")
  @Permissions("attendance.view")
  getKpis(@Query() query: AttendanceKpisQueryDto) {
    return this.attendance.getKpis(query);
  }

  @Get(":staffProfileId/monthly")
  @Permissions("attendance.view")
  getMonthlyDetail(@Param("staffProfileId") staffProfileId: string, @Query("month") month: string) {
    return this.attendance.getMonthlyDetail(staffProfileId, month);
  }

  @Get(":staffProfileId/days/:date")
  @Permissions("attendance.view")
  getDayDetail(@Param("staffProfileId") staffProfileId: string, @Param("date") date: string) {
    return this.attendance.getDayDetail(staffProfileId, date);
  }

  @Patch(":staffProfileId/days/:date")
  @Permissions("attendance.edit")
  updateDay(
    @Param("staffProfileId") staffProfileId: string,
    @Param("date") date: string,
    @Body() dto: UpdateAttendanceDayDto,
  ) {
    return this.attendance.updateDay(staffProfileId, date, dto);
  }

  @Get()
  @Permissions("attendance.view")
  list(@Query() query: ListAttendanceQueryDto) {
    return this.attendance.list(query);
  }
}

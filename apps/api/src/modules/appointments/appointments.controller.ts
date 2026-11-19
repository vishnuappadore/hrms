import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { BranchScoped, Permissions } from "../../common/decorators";
import { AppointmentsService } from "./appointments.service";
import {
  CreateAppointmentDto,
  ListAppointmentsQueryDto,
  ListBarbersQueryDto,
  ListSlotsQueryDto,
  UpdateAppointmentDto,
} from "./appointments.dto";

@Controller("appointments")
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  @Permissions("appointments.view")
  @BranchScoped("branchId")
  list(@Query() query: ListAppointmentsQueryDto) {
    return this.appointments.list(query);
  }

  /** Static routes must precede :appointmentId or they'd match the param route. */
  @Get("barbers")
  @Permissions("appointments.view")
  @BranchScoped("branchId")
  listBarbers(@Query() query: ListBarbersQueryDto) {
    return this.appointments.listBarbers(query);
  }

  @Get("slots")
  @Permissions("appointments.view")
  @BranchScoped("branchId")
  listSlots(@Query() query: ListSlotsQueryDto) {
    return this.appointments.listSlots(query);
  }

  @Get(":appointmentId")
  @Permissions("appointments.view")
  getById(@Param("appointmentId") appointmentId: string) {
    return this.appointments.getById(appointmentId);
  }

  @Post()
  @Permissions("appointments.create")
  @BranchScoped("branchId")
  create(@Body() dto: CreateAppointmentDto) {
    return this.appointments.create(dto);
  }

  @Patch(":appointmentId")
  @Permissions("appointments.update")
  update(@Param("appointmentId") appointmentId: string, @Body() dto: UpdateAppointmentDto) {
    return this.appointments.update(appointmentId, dto);
  }

  /* ── Status machine actions (Appointment Details modal) ─────────────────── */

  @Post(":appointmentId/confirm")
  @Permissions("appointments.update")
  confirm(@Param("appointmentId") appointmentId: string) {
    return this.appointments.transition(appointmentId, { status: "confirmed" });
  }

  @Post(":appointmentId/start")
  @Permissions("appointments.checkin")
  start(@Param("appointmentId") appointmentId: string) {
    return this.appointments.transition(appointmentId, { status: "in_progress" });
  }

  @Post(":appointmentId/complete")
  @Permissions("appointments.checkin")
  complete(@Param("appointmentId") appointmentId: string) {
    return this.appointments.transition(appointmentId, { status: "completed" });
  }

  @Post(":appointmentId/cancel")
  @Permissions("appointments.cancel")
  cancel(@Param("appointmentId") appointmentId: string) {
    return this.appointments.transition(appointmentId, { status: "cancelled" });
  }
}

import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { BranchScoped, Permissions } from "../../common/decorators";
import { WalkInsService } from "./walk-ins.service";
import {
  AssignWalkInBarberDto,
  CreateWalkInDto,
  ListWalkInsQueryDto,
  UpdateWalkInDto,
} from "./walk-ins.dto";

@Controller("walk-ins")
export class WalkInsController {
  constructor(private readonly walkIns: WalkInsService) {}

  @Get()
  @Permissions("walkin.view")
  @BranchScoped("branchId")
  list(@Query() query: ListWalkInsQueryDto) {
    return this.walkIns.list(query);
  }

  /** Static routes must precede :walkInId or they'd match the param route. */
  @Get("stats")
  @Permissions("walkin.view")
  @BranchScoped("branchId")
  stats(@Query("branchId") branchId?: string) {
    return this.walkIns.stats(branchId);
  }

  @Get(":walkInId")
  @Permissions("walkin.view")
  getById(@Param("walkInId") walkInId: string) {
    return this.walkIns.getById(walkInId);
  }

  @Post()
  @Permissions("walkin.create")
  @BranchScoped("branchId")
  create(@Body() dto: CreateWalkInDto) {
    return this.walkIns.create(dto);
  }

  @Patch(":walkInId")
  @Permissions("walkin.update")
  update(@Param("walkInId") walkInId: string, @Body() dto: UpdateWalkInDto) {
    return this.walkIns.update(walkInId, dto);
  }

  @Patch(":walkInId/barber")
  @Permissions("walkin.update")
  assignBarber(@Param("walkInId") walkInId: string, @Body() dto: AssignWalkInBarberDto) {
    return this.walkIns.assignBarber(walkInId, dto);
  }

  /* ── Status machine actions ───────────────────────────────────────────── */

  @Post(":walkInId/start")
  @Permissions("walkin.checkin")
  start(@Param("walkInId") walkInId: string) {
    return this.walkIns.transition(walkInId, "serving");
  }

  @Post(":walkInId/complete")
  @Permissions("walkin.checkin")
  complete(@Param("walkInId") walkInId: string) {
    return this.walkIns.transition(walkInId, "completed");
  }

  @Post(":walkInId/cancel")
  @Permissions("walkin.cancel")
  cancel(@Param("walkInId") walkInId: string) {
    return this.walkIns.transition(walkInId, "cancelled");
  }
}

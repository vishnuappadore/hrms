import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { Permissions } from "../../common/decorators";
import { RolesService } from "./roles.service";
import { CreateRoleDto, UpdateRoleDto } from "./roles.dto";

@Controller("roles")
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** Read-only role listing for the employee form dropdown — no permission data. */
  @Get()
  @Permissions("employee.view")
  list() {
    return this.roles.listRoles();
  }

  @Get("summaries")
  @Permissions("roles.manage")
  listSummaries() {
    return this.roles.list();
  }

  @Get(":id")
  @Permissions("roles.manage")
  getDetail(@Param("id") id: string) {
    return this.roles.getDetail(id);
  }

  @Post()
  @Permissions("roles.manage")
  create(@Body() dto: CreateRoleDto) {
    return this.roles.create(dto);
  }

  @Patch(":id")
  @Permissions("roles.manage")
  update(@Param("id") id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(id, dto);
  }

  @Delete(":id")
  @Permissions("roles.manage")
  remove(@Param("id") id: string) {
    return this.roles.remove(id);
  }
}

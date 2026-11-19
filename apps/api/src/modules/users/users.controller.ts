import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser, Permissions } from "../../common/decorators";
import type { RequestContext } from "../../common/request-context";
import { UsersService } from "./users.service";
import {
  CreateUserDto,
  ListUsersQueryDto,
  ResetUserPasswordDto,
  UpdateUserDto,
} from "./users.dto";

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** The authenticated user's own profile — used by the web shell on load. */
  @Get("me")
  me(@CurrentUser() ctx: RequestContext) {
    return this.users.getMe(ctx.userId);
  }

  @Get()
  @Permissions("staff.view")
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  @Get(":userId")
  @Permissions("staff.view")
  getById(@Param("userId") userId: string) {
    return this.users.getById(userId);
  }

  /** Also requires staff.employment.manage — this payload now carries salary/commission. */
  @Post()
  @Permissions("staff.create", "staff.employment.manage")
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(":userId")
  @Permissions("staff.update", "staff.employment.manage")
  update(@Param("userId") userId: string, @Body() dto: UpdateUserDto) {
    return this.users.update(userId, dto);
  }

  @Post(":userId/reset-password")
  @Permissions("staff.update")
  resetPassword(@Param("userId") userId: string, @Body() dto: ResetUserPasswordDto) {
    return this.users.resetPassword(userId, dto.password);
  }
}

import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { BranchScoped, Permissions } from "../../common/decorators";
import { BranchesService } from "./branches.service";
import { CreateBranchDto, ListBranchesQueryDto, UpdateBranchDto } from "./branches.dto";

@Controller("branches")
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @Permissions("branches.view")
  list(@Query() query: ListBranchesQueryDto) {
    return this.branches.list(query);
  }

  /** Must be declared before :branchId or "stats" would match the param route. */
  @Get("stats")
  @Permissions("branches.view")
  stats() {
    return this.branches.stats();
  }

  @Get(":branchId")
  @Permissions("branches.view")
  @BranchScoped("branchId")
  getById(@Param("branchId") branchId: string) {
    return this.branches.getById(branchId);
  }

  @Post()
  @Permissions("branches.create")
  create(@Body() dto: CreateBranchDto) {
    return this.branches.create(dto);
  }

  @Patch(":branchId")
  @Permissions("branches.update")
  @BranchScoped("branchId")
  update(@Param("branchId") branchId: string, @Body() dto: UpdateBranchDto) {
    return this.branches.update(branchId, dto);
  }
}

import { Controller, Get, Query } from "@nestjs/common";
import { Permissions } from "../../common/decorators";
import { BranchesService } from "./branches.service";
import { ListFranchiseOwnersQueryDto } from "./branches.dto";

/**
 * Read-only list powering the "existing franchise owner" dropdown on the
 * branch form. Owners are created inline via POST /branches (newOwner).
 */
@Controller("franchise-owners")
export class FranchiseOwnersController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @Permissions("branches.view")
  list(@Query() query: ListFranchiseOwnersQueryDto) {
    return this.branches.listFranchiseOwners(query);
  }
}

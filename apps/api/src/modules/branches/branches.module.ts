import { Module } from "@nestjs/common";
import { BranchesController } from "./branches.controller";
import { BranchesService } from "./branches.service";
import { FranchiseOwnersController } from "./franchise-owners.controller";

@Module({
  controllers: [BranchesController, FranchiseOwnersController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}

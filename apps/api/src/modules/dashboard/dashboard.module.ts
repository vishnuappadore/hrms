import { Module } from "@nestjs/common";
import { WalkInsModule } from "../walk-ins/walk-ins.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";

/** Pure read-only orchestrator over already-built modules' data — never the reverse
 *  (apps/api/CLAUDE.md's module-pattern rule), hence importing WalkInsModule for its
 *  exported service rather than re-deriving walk-in stats here. */
@Module({
  imports: [WalkInsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}

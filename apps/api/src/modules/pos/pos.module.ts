import { Module } from "@nestjs/common";
import { RedisService } from "../../common/redis.service";
import { TaxesModule } from "../taxes/taxes.module";
import { WalkInsModule } from "../walk-ins/walk-ins.module";
import { InvoicePdfService } from "./invoice-pdf.service";
import { PosController } from "./pos.controller";
import { PosService } from "./pos.service";

@Module({
  imports: [TaxesModule, WalkInsModule],
  controllers: [PosController],
  providers: [PosService, RedisService, InvoicePdfService],
  exports: [PosService],
})
export class PosModule {}

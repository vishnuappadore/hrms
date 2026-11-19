import { Module } from "@nestjs/common";
import { AttendanceModule } from "../attendance/attendance.module";
import { LeaveModule } from "../leave/leave.module";
import { PayrollController } from "./payroll.controller";
import { PayrollService } from "./payroll.service";
import { PayslipPdfService } from "./payslip-pdf.service";

@Module({
  imports: [AttendanceModule, LeaveModule],
  controllers: [PayrollController],
  providers: [PayrollService, PayslipPdfService],
  exports: [PayrollService],
})
export class PayrollModule {}

import { Body, Controller, Get, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { BranchScoped, Permissions } from "../../common/decorators";
import { PayrollService } from "./payroll.service";
import { PayslipPdfService } from "./payslip-pdf.service";
import {
  BulkPayrollActionDto,
  EditPayrollItemDto,
  GeneratePayrollRunDto,
  GetPayrollRunQueryDto,
  ListPayrollBatchesQueryDto,
  ListPayrollBatchItemsQueryDto,
  ListPayrollItemsQueryDto,
  RejectPayrollItemDto,
} from "./payroll.dto";

@Controller("payroll")
export class PayrollController {
  constructor(
    private readonly payroll: PayrollService,
    private readonly payslipPdf: PayslipPdfService,
  ) {}

  @Get("runs")
  @Permissions("payroll.view")
  @BranchScoped("branchId")
  getRun(@Query() query: GetPayrollRunQueryDto) {
    return this.payroll.getRun(query);
  }

  /** Read-only preview of what generating/syncing would do — lets the web app confirm before committing. */
  @Get("runs/preview")
  @Permissions("payroll.view")
  @BranchScoped("branchId")
  previewRun(@Query() query: GetPayrollRunQueryDto) {
    return this.payroll.previewRun(query);
  }

  /**
   * Idempotent for the run itself — returns the existing run for (branch,
   * month) if one exists, but also syncs in any employee newly eligible for
   * this branch since the run was first generated (see PayrollService).
   */
  @Post("runs")
  @Permissions("payroll.generate")
  @BranchScoped("branchId")
  generateRun(@Body() dto: GeneratePayrollRunDto) {
    return this.payroll.generateRun(dto);
  }

  @Get("runs/:runId/items")
  @Permissions("payroll.view")
  listItems(@Param("runId") runId: string, @Query() query: ListPayrollItemsQueryDto) {
    return this.payroll.listItems(runId, query);
  }

  @Get("runs/:runId/batches")
  @Permissions("payroll.view")
  listBatches(@Param("runId") runId: string, @Query() query: ListPayrollBatchesQueryDto) {
    return this.payroll.listBatches(runId, query.tab);
  }

  /** Paginated items for one batch — powers the Batch view's right-hand pane. */
  @Get("runs/:runId/batches/:batchId/items")
  @Permissions("payroll.view")
  listBatchItems(
    @Param("runId") runId: string,
    @Param("batchId") batchId: string,
    @Query() query: ListPayrollBatchItemsQueryDto,
  ) {
    return this.payroll.listBatchItems(runId, batchId, query);
  }

  /** Bulk actions apply only within the Pending tab (docs/MODULES/payroll.md). */
  @Post("runs/:runId/bulk-approve")
  @Permissions("payroll.approve")
  bulkApprove(@Param("runId") runId: string, @Body() dto: BulkPayrollActionDto) {
    return this.payroll.bulkApprove(runId, dto);
  }

  @Post("runs/:runId/bulk-reject")
  @Permissions("payroll.reject")
  bulkReject(@Param("runId") runId: string, @Body() dto: BulkPayrollActionDto) {
    return this.payroll.bulkReject(runId, dto);
  }

  @Post("runs/:runId/bulk-mark-paid")
  @Permissions("payroll.mark_paid")
  bulkMarkPaid(@Param("runId") runId: string, @Body() dto: BulkPayrollActionDto) {
    return this.payroll.bulkMarkPaid(runId, dto);
  }

  /** Reopen a batch of Approved/Rejected items back to Pending for correction. */
  @Post("runs/:runId/bulk-revert")
  @Permissions("payroll.approve")
  bulkRevert(@Param("runId") runId: string, @Body() dto: BulkPayrollActionDto) {
    return this.payroll.bulkRevert(runId, dto);
  }

  /** Recomputes every selected (or all-matching) Pending item's system-computed figures. */
  @Post("runs/:runId/bulk-recompute")
  @Permissions("payroll.edit")
  bulkRecompute(@Param("runId") runId: string, @Body() dto: BulkPayrollActionDto) {
    return this.payroll.bulkRecompute(runId, dto);
  }

  @Get("items/:itemId")
  @Permissions("payroll.view")
  getItem(@Param("itemId") itemId: string) {
    return this.payroll.getItemDetail(itemId);
  }

  @Patch("items/:itemId")
  @Permissions("payroll.edit")
  editItem(@Param("itemId") itemId: string, @Body() dto: EditPayrollItemDto) {
    return this.payroll.editItem(itemId, dto);
  }

  /** Refreshes a still-Pending item's system-computed figures from current leave/attendance data. */
  @Post("items/:itemId/recompute")
  @Permissions("payroll.edit")
  recomputeItem(@Param("itemId") itemId: string) {
    return this.payroll.recomputeItem(itemId);
  }

  @Post("items/:itemId/approve")
  @Permissions("payroll.approve")
  approveItem(@Param("itemId") itemId: string) {
    return this.payroll.approveItem(itemId);
  }

  @Post("items/:itemId/reject")
  @Permissions("payroll.reject")
  rejectItem(@Param("itemId") itemId: string, @Body() dto: RejectPayrollItemDto) {
    return this.payroll.rejectItem(itemId, dto.reason);
  }

  @Post("items/:itemId/mark-paid")
  @Permissions("payroll.mark_paid")
  markPaid(@Param("itemId") itemId: string) {
    return this.payroll.markPaidItem(itemId);
  }

  /** Reopen an Approved or Rejected item back to Pending for correction. */
  @Post("items/:itemId/revert")
  @Permissions("payroll.approve")
  revert(@Param("itemId") itemId: string) {
    return this.payroll.revertItem(itemId);
  }

  @Get("items/:itemId/payslip.pdf")
  @Permissions("payroll.view")
  async downloadPayslip(
    @Param("itemId") itemId: string,
    @Query("locale") locale: string | undefined,
    @Res() res: Response,
  ) {
    const detail = await this.payroll.getItemDetail(itemId);
    const resolvedLocale = locale === "ar" ? "ar" : "en";
    const buffer = await this.payslipPdf.render(detail, resolvedLocale);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="payslip-${detail.payrollMonth}-${itemId.slice(0, 8)}.pdf"`,
    });
    res.send(buffer);
  }
}

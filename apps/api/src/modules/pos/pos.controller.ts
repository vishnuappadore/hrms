import { Body, Controller, Get, Headers, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { BranchScoped, Permissions } from "../../common/decorators";
import { WalkInsService } from "../walk-ins/walk-ins.service";
import { InvoicePdfService } from "./invoice-pdf.service";
import { PosService } from "./pos.service";
import { CheckoutDto, ListInvoicesQueryDto } from "./pos.dto";

@Controller("pos")
export class PosController {
  constructor(
    private readonly pos: PosService,
    private readonly walkIns: WalkInsService,
    private readonly invoicePdf: InvoicePdfService,
  ) {}

  /**
   * Walk-in → POS prefill (entry point 3). Gated on pos.use, not walkin.view: a cashier who can
   * check out must be able to load the entry they're checking out. Same branch scoping as
   * GET /walk-ins/:id (WalkInsService.getById).
   */
  @Get("walk-ins/:walkInId")
  @Permissions("pos.use")
  getWalkInForCheckout(@Param("walkInId") walkInId: string) {
    return this.walkIns.getById(walkInId);
  }

  @Post("checkout")
  @Permissions("pos.use")
  @BranchScoped("branchId")
  checkout(@Body() dto: CheckoutDto, @Headers("idempotency-key") idempotencyKey?: string) {
    return this.pos.checkout(dto, idempotencyKey);
  }

  @Get("invoices")
  @Permissions("invoices.view")
  @BranchScoped("branchId")
  listInvoices(@Query() query: ListInvoicesQueryDto) {
    return this.pos.list(query);
  }

  @Get("invoices/:invoiceId")
  @Permissions("invoices.view")
  getInvoice(@Param("invoiceId") invoiceId: string) {
    return this.pos.getById(invoiceId);
  }

  @Get("invoices/:invoiceId/invoice.pdf")
  @Permissions("invoices.view")
  async downloadInvoice(
    @Param("invoiceId") invoiceId: string,
    @Query("locale") locale: string | undefined,
    @Res() res: Response,
  ) {
    const invoice = await this.pos.getById(invoiceId);
    const resolvedLocale = locale === "ar" ? "ar" : "en";
    const buffer = await this.invoicePdf.render(invoice, resolvedLocale);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="invoice-${invoice.invoiceNo}.pdf"`,
    });
    res.send(buffer);
  }
}

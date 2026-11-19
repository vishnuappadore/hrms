import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { chromium, type Browser } from "playwright";
import type { Invoice } from "@keystonehr/shared";
import { PrismaService } from "../../database/prisma.service";
import { renderInvoiceHtml } from "./invoice-pdf.template";

/**
 * Renders the bilingual invoice/receipt to PDF via a headless Chromium
 * instance (reused across requests), mirroring PayslipPdfService — same
 * Arabic text-shaping rationale (docs/MODULES/payroll.md) and the same
 * Chromium/font deployment requirement (docs/DEVELOPMENT.md).
 */
@Injectable()
export class InvoicePdfService implements OnModuleDestroy {
  private browserPromise: Promise<Browser> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async render(invoice: Invoice, locale: "en" | "ar"): Promise<Buffer> {
    const tenant = await this.prisma.client.tenant.findFirst({ select: { name: true } });
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(renderInvoiceHtml(invoice, locale, tenant?.name ?? "Keystone HR"), {
        waitUntil: "load",
      });
      const buffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
      });
      return buffer;
    } finally {
      await page.close();
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = chromium.launch({ headless: true });
    }
    return this.browserPromise;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browserPromise) {
      const browser = await this.browserPromise;
      await browser.close();
    }
  }
}

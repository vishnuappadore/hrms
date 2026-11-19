import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { chromium, type Browser } from "playwright";
import type { PayrollItemDetail } from "@keystonehr/shared";
import { PrismaService } from "../../database/prisma.service";
import { renderPayslipHtml } from "./payslip-pdf.template";

/**
 * Renders the bilingual payslip to PDF via a headless Chromium instance
 * (reused across requests — launching a browser per request is too slow).
 * Chosen over a pure-JS PDF library because Arabic text shaping/ligatures
 * need real browser text layout; see docs/MODULES/payroll.md.
 *
 * Deployment note: the API's Docker image needs Chromium's system deps AND
 * an Arabic-capable font package installed (e.g. `fonts-noto` on Debian) —
 * Chromium's rendering engine handles the shaping, but still needs real
 * glyphs on disk. Tracked in docs/DEVELOPMENT.md.
 */
@Injectable()
export class PayslipPdfService implements OnModuleDestroy {
  private browserPromise: Promise<Browser> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async render(detail: PayrollItemDetail, locale: "en" | "ar"): Promise<Buffer> {
    const tenant = await this.prisma.client.tenant.findFirst({
      select: { name: true, useWesternNumeralsInArabic: true },
    });
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(
        renderPayslipHtml(
          detail,
          locale,
          tenant?.name ?? "Keystone HR",
          tenant?.useWesternNumeralsInArabic ?? true,
        ),
        { waitUntil: "load" },
      );
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

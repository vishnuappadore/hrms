import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import localFont from "next/font/local";
import { routing, type AppLocale } from "@/i18n/routing";
import { Providers } from "./providers";
import "../globals.css";

/* Self-hosted (next/font/local): no external requests, no font flash.
   Both variables ride on <html> so Latin inside Arabic UI falls back to Lexend.
   Design faces (claude.ai design): Lexend (Latin UI) + Cairo (Arabic UI). */
const lexend = localFont({
  src: "../../fonts/lexend-latin.woff2",
  weight: "100 900",
  variable: "--font-lexend",
  display: "swap",
});

const cairo = localFont({
  src: "../../fonts/cairo-arabic.woff2",
  weight: "100 900",
  variable: "--font-cairo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Keystone HR",
  description: "Salon management",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as AppLocale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      className={`${lexend.variable} ${cairo.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Apply the persisted brand palette before first paint (mirrors next-themes) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var b=localStorage.getItem("hr-brand");if(b)document.documentElement.setAttribute("data-brand",b)}catch(e){}`,
          }}
        />
      </head>
      <body className="bg-background text-foreground antialiased">
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

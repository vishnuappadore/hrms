import Image from "next/image";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { BrandSwitcher } from "@/components/brand-switcher";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { LoginForm } from "./login-form";

/** "identifier:password" — set NEXT_PUBLIC_DEMO_LOGIN to surface the demo-credentials card. */
function demoCredentials() {
  const raw = process.env.NEXT_PUBLIC_DEMO_LOGIN;
  if (!raw) return null;
  const sep = raw.indexOf(":");
  if (sep <= 0 || sep === raw.length - 1) return null;
  return { identifier: raw.slice(0, sep), password: raw.slice(sep + 1) };
}

export default function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <LoginContent demo={demoCredentials()} />;
}

function LoginContent({ demo }: { demo: { identifier: string; password: string } | null }) {
  const t = useTranslations("login");
  const tc = useTranslations("common");

  return (
    <main className="relative flex min-h-screen">
      {/* Brand panel — dark shell with soft brand glows (lg and up) */}
      <aside className="relative hidden w-[46%] max-w-[620px] flex-none overflow-hidden border-e border-sidebar-border bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 -start-20 h-[26rem] w-[26rem] rounded-full bg-sidebar-active/15 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 -end-28 h-[29rem] w-[29rem] rounded-full bg-sidebar-active/10 blur-3xl"
        />

        <div className="relative">
          <Image
            src="/logo.png"
            alt={tc("appName")}
            width={212}
            height={104}
            priority
            className="h-[52px] w-auto"
          />
        </div>

        <div className="relative max-w-md">
          <div
            aria-hidden="true"
            className="mb-6 h-[3px] w-11 rounded-full bg-linear-to-r from-sidebar-active to-sidebar-active/40"
          />
          <h2 className="text-[2.125rem] font-semibold leading-tight tracking-tight text-white">
            {t("brandTitle")}
          </h2>
          <p className="mt-4 text-[15px] font-light leading-relaxed text-sidebar-muted-foreground">
            {t("brandSub")}
          </p>
        </div>
      </aside>

      {/* Form panel */}
      <div className="relative flex flex-1 items-center justify-center p-6 sm:p-10">
        <div className="absolute top-5 end-6 flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
          <BrandSwitcher />
        </div>

        <div className="w-full max-w-[400px]">
          {/* dark chip keeps the light-on-transparent logo legible in light mode */}
          <div className="mx-auto mb-9 w-fit rounded-2xl bg-sidebar px-5 py-3 lg:hidden">
            <Image src="/logo.png" alt={tc("appName")} width={163} height={80} className="h-10 w-auto" />
          </div>

          <h1 className="text-[1.75rem] font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("subtitle")}</p>

          <LoginForm demo={demo} />
        </div>
      </div>
    </main>
  );
}

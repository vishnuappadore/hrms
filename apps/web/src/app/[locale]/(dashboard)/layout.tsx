import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { DashboardShell } from "./dashboard-shell";

export default function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <DashboardShell>{children}</DashboardShell>;
}

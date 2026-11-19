import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { AppointmentsContent } from "./appointments-content";

export default function AppointmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ newForCustomerId?: string }>;
}) {
  const { locale } = use(params);
  const { newForCustomerId } = use(searchParams);
  setRequestLocale(locale);
  return <AppointmentsContent initialCustomerId={newForCustomerId ?? null} />;
}

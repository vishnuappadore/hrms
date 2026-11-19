import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { ServicesContent } from "./services-content";

export default function ServicesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <ServicesContent />;
}

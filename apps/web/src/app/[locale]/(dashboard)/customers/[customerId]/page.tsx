import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { CustomerProfile } from "./customer-profile";

export default function CustomerProfilePage({
  params,
}: {
  params: Promise<{ locale: string; customerId: string }>;
}) {
  const { locale, customerId } = use(params);
  setRequestLocale(locale);
  return <CustomerProfile customerId={customerId} />;
}

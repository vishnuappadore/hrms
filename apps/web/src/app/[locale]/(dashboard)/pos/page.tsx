import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { PosContent } from "./pos-content";

export default function PosPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ appointmentId?: string; customerId?: string; walkInId?: string }>;
}) {
  const { locale } = use(params);
  const { appointmentId, customerId, walkInId } = use(searchParams);
  setRequestLocale(locale);
  return (
    <PosContent
      appointmentId={appointmentId ?? null}
      initialCustomerId={customerId ?? null}
      walkInId={walkInId ?? null}
    />
  );
}

import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { EditServiceContent } from "./edit-service-content";

export default function EditServicePage({
  params,
}: {
  params: Promise<{ locale: string; serviceId: string }>;
}) {
  const { locale, serviceId } = use(params);
  setRequestLocale(locale);
  return <EditServiceContent serviceId={serviceId} />;
}

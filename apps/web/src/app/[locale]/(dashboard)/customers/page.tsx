import { setRequestLocale } from "next-intl/server";
import { Suspense, use } from "react";
import { CustomersContent } from "./customers-content";

export default function CustomersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  // CustomersContent reads useSearchParams() (seeds search from ?search=),
  // which requires a Suspense boundary for the static build to succeed.
  return (
    <Suspense>
      <CustomersContent />
    </Suspense>
  );
}

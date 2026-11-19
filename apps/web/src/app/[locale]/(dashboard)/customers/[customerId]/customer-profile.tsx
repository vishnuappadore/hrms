"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BackLink } from "@/components/back-link";
import { Alert } from "@/components/ui/alert";
import { useCustomer } from "@/lib/queries/customers";
import { CustomerDetailView } from "../customer-detail-view";
import { CustomerDrawer, type CustomerDrawerState } from "../customer-drawer";

export function CustomerProfile({ customerId }: { customerId: string }) {
  const t = useTranslations("customers");
  const tc = useTranslations("common");
  const { data: customer, isLoading, isError } = useCustomer(customerId);
  const [drawerState, setDrawerState] = useState<CustomerDrawerState>(null);

  if (isLoading) {
    return <div className="mx-auto h-64 max-w-3xl animate-pulse rounded-xl bg-muted" />;
  }
  if (isError || !customer) {
    return <Alert>{tc("loadFailed")}</Alert>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <BackLink href="/customers" label={t("backToList")} />
      <CustomerDetailView
        customer={customer}
        onEdit={() => setDrawerState({ mode: "edit", customer })}
      />
      <CustomerDrawer state={drawerState} onClose={() => setDrawerState(null)} />
    </div>
  );
}

"use client";

import { useTranslations } from "next-intl";
import type { Branch } from "@keystonehr/shared";
import { Alert } from "@/components/ui/alert";
import { Drawer } from "@/components/ui/drawer";
import { useAppointment } from "@/lib/queries/appointments";
import { AppointmentDetailView } from "./appointment-detail-view";
import { AppointmentWizard } from "./appointment-wizard";

export type AppointmentDrawerState =
  | { mode: "create"; customerId?: string }
  | { mode: "view"; appointmentId: string }
  | { mode: "edit"; appointmentId: string }
  | null;

/**
 * Add / View / Edit, all in one slide-in `Drawer` (mirrors
 * `queue/walk-in-drawer.tsx`). View and Edit both fetch the full appointment
 * by id; Create skips the fetch entirely.
 */
export function AppointmentDrawer({
  state,
  branch,
  onClose,
  onEdit,
}: {
  state: AppointmentDrawerState;
  branch: Branch | undefined;
  onClose: () => void;
  onEdit: (appointmentId: string) => void;
}) {
  const t = useTranslations("appointments");
  const tc = useTranslations("common");

  const appointmentId = state?.mode === "view" || state?.mode === "edit" ? state.appointmentId : null;
  const { data: appointment, isLoading, isError } = useAppointment(appointmentId);

  const title =
    state?.mode === "edit"
      ? t("wizard.editTitle")
      : state?.mode === "view"
        ? appointment
          ? t("detail.title", { number: appointment.appointmentNo })
          : undefined
        : t("wizard.title");

  return (
    <Drawer open={state !== null && !!branch} onClose={onClose} title={title} closeLabel={tc("close")} size="xl">
      {!branch || state === null ? null : appointmentId && isLoading ? (
        <div className="space-y-3 py-4">
          <div className="h-5 w-40 animate-pulse rounded bg-muted" />
          <div className="h-24 w-full animate-pulse rounded bg-muted" />
        </div>
      ) : appointmentId && (isError || !appointment) ? (
        <Alert>{tc("loadFailed")}</Alert>
      ) : state.mode === "view" && appointment ? (
        <AppointmentDetailView appointment={appointment} onEdit={() => onEdit(appointment.id)} />
      ) : (
        <AppointmentWizard
          key={state.mode === "edit" ? state.appointmentId : "create"}
          branch={branch}
          mode={state.mode === "edit" ? "edit" : "create"}
          appointment={state.mode === "edit" ? appointment : undefined}
          initialCustomerId={state.mode === "create" ? state.customerId : undefined}
          onDone={onClose}
        />
      )}
    </Drawer>
  );
}

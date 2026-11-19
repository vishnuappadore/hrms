"use client";

import { useState, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TRANSITIONS,
  type Appointment,
  type AppointmentStatus,
} from "@keystonehr/shared";
import { cn } from "@/lib/cn";
import { usePermissions } from "@/lib/permissions";
import { Alert } from "@/components/ui/alert";
import { useToast } from "@/components/ui/toast";
import { useAppointmentAction, useAppointments } from "@/lib/queries/appointments";
import { ACTION_BY_STATUS, AppointmentCard } from "./appointment-card";

interface KanbanProps {
  branchId: string | undefined;
  search?: string;
  from?: string;
  to?: string;
  onOpen: (id: string) => void;
}

/** Wraps `AppointmentCard` as a drag source; dragging is disabled once the appointment has no valid next status. */
function DraggableCard({
  appointment,
  onOpen,
  disabled,
}: {
  appointment: Appointment;
  onOpen: (id: string) => void;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: appointment.id,
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn("touch-none", isDragging && "opacity-40")}
    >
      <AppointmentCard appointment={appointment} onOpen={onOpen} />
    </div>
  );
}

/** A status column; highlights while a card is dragged over it, dimmed when the move isn't allowed. */
function StatusColumn({
  status,
  label,
  count,
  isLoading,
  isValidTarget,
  isDragActive,
  children,
}: {
  status: AppointmentStatus;
  label: string;
  count: number;
  isLoading: boolean;
  isValidTarget: boolean;
  isDragActive: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !isValidTarget });
  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex max-h-[70vh] min-w-0 flex-1 flex-col rounded-xl border border-border bg-muted/30 transition",
        isDragActive && !isValidTarget && "opacity-50",
        isOver && isValidTarget && "border-tint-info-border bg-tint-info-bg/40 ring-2 ring-tint-info-border",
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {isLoading ? "…" : count}
        </span>
      </header>
      <div className="flex flex-col gap-2 overflow-y-auto p-2">{children}</div>
    </section>
  );
}

/**
 * Status board for the selected branch: one column per status, cards grouped by
 * their current status. Status is the axis here, so the shared status filter is
 * not applied; the shared search and date range still narrow the cards.
 * Dragging a card onto another column moves it through the same status-machine
 * action (`ACTION_BY_STATUS`/`APPOINTMENT_TRANSITIONS`) as the detail view's
 * action buttons — a drop is only accepted if the target is a valid transition
 * and the user holds the required permission.
 */
export function AppointmentKanban({ branchId, search, from, to, onOpen }: KanbanProps) {
  const t = useTranslations("appointments");
  const td = useTranslations("appointments.detail");
  const tc = useTranslations("common");
  const permissions = usePermissions();
  const { showToast } = useToast();
  const action = useAppointmentAction();
  const { data, isLoading, isError } = useAppointments({ branchId, search, from, to, pageSize: 100 });
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  if (isError) {
    return <Alert>{tc("loadFailed")}</Alert>;
  }

  const appointments = data?.data ?? [];
  const byStatus = (status: AppointmentStatus): Appointment[] =>
    appointments.filter((a) => a.status === status);
  const draggingAppointment = appointments.find((a) => a.id === draggingId);

  function isValidTarget(source: AppointmentStatus, target: AppointmentStatus): boolean {
    if (source === target) return false;
    if (!APPOINTMENT_TRANSITIONS[source].includes(target)) return false;
    const spec = ACTION_BY_STATUS[target as Exclude<AppointmentStatus, "waiting">];
    return !!spec && permissions.includes(spec.permission);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const sourceAppointment = appointments.find((a) => a.id === event.active.id);
    const targetStatus = event.over?.id as AppointmentStatus | undefined;
    if (!sourceAppointment || !targetStatus) return;
    if (!isValidTarget(sourceAppointment.status, targetStatus)) return;

    const spec = ACTION_BY_STATUS[targetStatus as Exclude<AppointmentStatus, "waiting">]!;
    try {
      await action.mutateAsync({ id: sourceAppointment.id, action: spec.action });
    } catch {
      showToast(td("actionFailed"));
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setDraggingId(e.active.id as string)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingId(null)}
    >
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3" style={{ minWidth: `${APPOINTMENT_STATUSES.length * 15}rem` }}>
          {APPOINTMENT_STATUSES.map((status) => {
            const items = byStatus(status);
            const validTarget = draggingAppointment
              ? isValidTarget(draggingAppointment.status, status)
              : false;
            return (
              <StatusColumn
                key={status}
                status={status}
                label={t(`status.${status}`)}
                count={items.length}
                isLoading={isLoading}
                isValidTarget={validTarget}
                isDragActive={!!draggingAppointment}
              >
                {isLoading ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
                  ))
                ) : items.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs text-muted-foreground">{t("kanban.empty")}</p>
                ) : (
                  items.map((a) => (
                    <DraggableCard
                      key={a.id}
                      appointment={a}
                      onOpen={onOpen}
                      disabled={!APPOINTMENT_TRANSITIONS[a.status].some((target) => isValidTarget(a.status, target))}
                    />
                  ))
                )}
              </StatusColumn>
            );
          })}
        </div>
      </div>
    </DndContext>
  );
}

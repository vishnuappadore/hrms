import type { PayrollItemStatus } from "@keystonehr/shared";

/** Badge only ships success/muted/destructive variants — Paid reuses success (Approved tab distinguishes by label). */
export function statusBadgeVariant(status: PayrollItemStatus): "success" | "muted" | "destructive" {
  if (status === "approved" || status === "paid") return "success";
  if (status === "rejected") return "destructive";
  return "muted";
}

/**
 * Resolved status/action matrix (docs/MODULES/payroll.md) — the mockup only
 * ever showed one static preview state, so these gates are the deliberate
 * implementation of "which actions are valid from which status":
 *   pending  → reject, approve
 *   approved → reject, mark paid, revert
 *   rejected → revert only
 *   paid     → read-only (view/download only)
 */
export function canApprove(status: PayrollItemStatus): boolean {
  return status === "pending";
}
export function canReject(status: PayrollItemStatus): boolean {
  return status === "pending" || status === "approved";
}
export function canMarkPaid(status: PayrollItemStatus): boolean {
  return status === "approved";
}
export function canRevert(status: PayrollItemStatus): boolean {
  return status === "approved" || status === "rejected";
}
export function canEdit(status: PayrollItemStatus): boolean {
  return status === "pending" || status === "approved";
}
/** Stricter than canEdit — recompute touches system-computed figures, Pending only (not yet approved). */
export function canRecompute(status: PayrollItemStatus): boolean {
  return status === "pending";
}

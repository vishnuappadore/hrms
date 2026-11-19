import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

export type IconActionVariant = "view" | "edit" | "delete" | "sell" | "neutral" | "complete";

/* Tinted icon wells for table Actions columns (matches the locked design's
   32x32 semantic-tint pattern: info/accent/destructive, never raw hex). */
const VARIANTS: Record<IconActionVariant, string> = {
  view: "bg-tint-info-bg border border-tint-info-border text-info hover:brightness-110",
  edit: "bg-tint-accent-bg border border-tint-accent-border text-primary hover:brightness-110",
  delete:
    "bg-tint-destructive-bg border border-tint-destructive-border text-destructive hover:brightness-110",
  /** Gold/amber well for a "sell"-type action (e.g. send a customer to POS) — reuses the warning tint. */
  sell: "bg-tint-warning-bg border border-tint-warning-border text-warning hover:brightness-110",
  /** Plain gray well, for an edit-style action that shouldn't carry the brand accent color. */
  neutral: "bg-muted border border-border text-muted-foreground hover:bg-muted/80",
  /** Green well for a terminal "mark done" action (e.g. Walk-in Queue's direct Complete). */
  complete:
    "bg-tint-positive-bg border border-tint-positive-border text-positive hover:brightness-110",
};

const BASE =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export interface IconActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: IconActionVariant;
  label: string;
}

export const IconActionButton = forwardRef<HTMLButtonElement, IconActionButtonProps>(
  function IconActionButton({ variant, label, className, type = "button", children, ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={cn(BASE, "disabled:pointer-events-none disabled:opacity-50", VARIANTS[variant], className)}
        {...props}
      >
        {children}
      </button>
    );
  },
);

export interface IconActionLinkProps {
  variant: IconActionVariant;
  label: string;
  href: string;
  className?: string;
  children: ReactNode;
}

/** Same tinted well, for row actions that navigate rather than trigger a handler. */
export function IconActionLink({ variant, label, href, className, children }: IconActionLinkProps) {
  return (
    <Link href={href} aria-label={label} title={label} className={cn(BASE, VARIANTS[variant], className)}>
      {children}
    </Link>
  );
}

"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

type DialogSize = "md" | "lg" | "xl";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Optional heading; omit to render a custom header inside children. */
  title?: string;
  /** Accessible name when there is no `title` (e.g. a wizard with a custom header). */
  ariaLabel?: string;
  size?: DialogSize;
  children: ReactNode;
  /** Extra classes on the dialog surface (e.g. a bespoke max-width). */
  className?: string;
  /** Adds a top-corner (×) close button alongside whatever the dialog's own footer provides. */
  showCloseButton?: boolean;
  /** aria-label for the close button; required when showCloseButton is true. */
  closeLabel?: string;
}

const SIZES: Record<DialogSize, string> = {
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-3xl",
};

/** Native <dialog> modal — focus trapping, Escape and backdrop come for free. */
export function Dialog({
  open,
  onClose,
  title,
  ariaLabel,
  size = "md",
  children,
  className,
  showCloseButton,
  closeLabel,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // Rendered via a portal straight onto <body> (below) rather than wherever this component sits in
  // the tree, so a dialog opened from inside another dialog's content is always a DOM sibling, not
  // nested inside it — this app now has that case (My Profile's own Leave tab opens Request Leave).
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // A plain `addEventListener` rather than the JSX `onClose` prop: with several <dialog> elements
  // (open and closed) present at once, closing one via its own Cancel/X button was observed to also
  // fire a native "close" on an unrelated open dialog when wired through JSX's `onClose`, silently
  // closing both. Binding the listener directly to this element's own node fixed it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("close", onClose);
    return () => el.removeEventListener("close", onClose);
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={title ? titleId : undefined}
      aria-label={!title ? ariaLabel : undefined}
      onClick={(e) => {
        // clicks on the backdrop target the <dialog> element itself
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "relative m-auto w-full rounded-xl border border-border bg-card p-6 text-foreground shadow-lg backdrop:bg-black/50",
        SIZES[size],
        className,
      )}
    >
      {showCloseButton && (
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="absolute end-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}
      {title ? (
        <h2 id={titleId} className={cn("mb-4 text-lg font-semibold", showCloseButton && "pe-8")}>
          {title}
        </h2>
      ) : null}
      {children}
    </dialog>,
    document.body,
  );
}

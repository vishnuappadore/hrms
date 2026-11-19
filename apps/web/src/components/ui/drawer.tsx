"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

const TRANSITION_MS = 300;

type DrawerSize = "md" | "lg" | "xl";

const SIZES: Record<DrawerSize, string> = {
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-3xl",
};

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Optional heading; omit to render a custom header inside children. */
  title?: string;
  /** Optional line under the title (e.g. "Customer details"). */
  description?: string;
  /** Accessible name when there is no `title`. */
  ariaLabel?: string;
  closeLabel: string;
  size?: DrawerSize;
  children: ReactNode;
  /** Extra classes on the drawer surface (e.g. a bespoke max-width). */
  className?: string;
}

/**
 * Slide-in panel from the trailing edge of the screen — for flows that want to stay anchored to
 * the triggering list (e.g. a create/edit form) rather than taking over the center like `Dialog`.
 * Not a native <dialog>: Escape/backdrop-close and the enter/exit transition are handled by hand,
 * since <dialog>'s top-layer has no slide-transform equivalent.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  ariaLabel,
  closeLabel,
  size = "md",
  children,
  className,
}: DrawerProps) {
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => setMounted(true), []);

  // Keeps the panel mounted through its exit transition before actually unmounting, and delays
  // the "slide in" class by one frame so the initial paint starts off-screen.
  useEffect(() => {
    if (open) {
      setRendered(true);
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    setVisible(false);
    const timeout = setTimeout(() => setRendered(false), TRANSITION_MS);
    return () => clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!rendered) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [rendered, onClose]);

  if (!mounted || !rendered) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className={cn(
          "absolute inset-0 bg-black/50 transition-opacity",
          visible ? "opacity-100" : "opacity-0",
        )}
        style={{ transitionDuration: `${TRANSITION_MS}ms` }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
        className={cn(
          "absolute inset-y-0 end-0 flex h-full w-full flex-col border-s border-border bg-card shadow-xl transition-transform ease-out",
          SIZES[size],
          visible ? "translate-x-0" : "translate-x-full rtl:-translate-x-full",
          className,
        )}
        style={{ transitionDuration: `${TRANSITION_MS}ms` }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          {title ? (
            <div>
              <h2 id={titleId} className="text-base font-semibold">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
            </div>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

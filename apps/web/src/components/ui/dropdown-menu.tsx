"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const DropdownMenuContext = createContext<(() => void) | null>(null);

interface DropdownMenuProps {
  /** Icon content for the trigger button. */
  trigger: ReactNode;
  /** Accessible name for the trigger button, e.g. common.moreActions. */
  triggerLabel: string;
  children: ReactNode;
}

/**
 * Small hand-rolled "more actions" menu — an in-place `absolute` panel, NOT a portal. A dialog shown
 * via native `<dialog>.showModal()` promotes itself to the browser's top layer, which always paints
 * above every ordinary DOM node regardless of z-index — a panel portaled to `document.body` would
 * render *behind* the modal, invisibly. Staying in-place and relying on the trigger sitting near the
 * top of the dialog's scrollable body (with ample room below it) avoids both that and the original
 * `overflow-y-auto` clipping risk from when the trigger lived in the bottom action row.
 */
export function DropdownMenu({ trigger, triggerLabel, children }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Capture phase + preventDefault: otherwise the enclosing native <dialog> still runs its
        // default "cancel" action and Escape closes the whole dialog, not just this menu.
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground transition hover:bg-border hover:text-foreground"
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 top-full z-20 mt-1 w-48 rounded-lg border border-border bg-card p-1 shadow-lg"
        >
          <DropdownMenuContext.Provider value={() => setOpen(false)}>{children}</DropdownMenuContext.Provider>
        </div>
      )}
    </div>
  );
}

interface DropdownMenuItemProps {
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: ReactNode;
}

export function DropdownMenuItem({ onSelect, disabled, destructive, children }: DropdownMenuItemProps) {
  const closeMenu = useContext(DropdownMenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onSelect();
        closeMenu?.();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm transition hover:bg-muted",
        destructive && "text-destructive hover:bg-destructive/10",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {children}
    </button>
  );
}

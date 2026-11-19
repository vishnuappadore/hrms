"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface ComboboxOption {
  value: string;
  label: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  placeholder?: string;
  clearLabel?: string;
  noResultsLabel?: string;
  id?: string;
}

/** Minimal searchable single-select — filters `options` as the admin types. */
export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  clearLabel,
  noResultsLabel,
  id,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function select(next: string | null) {
    onChange(next);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        id={id}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-lg border border-input bg-card px-3 text-[12.5px] text-foreground shadow-sm outline-none transition",
          "focus:border-ring focus:ring-2 focus:ring-ring/25",
        )}
      >
        <span className={cn("truncate text-start", !selected && "text-muted-foreground/60")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          aria-hidden="true"
          strokeWidth={1.75}
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        />
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card p-1 shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="mb-1 h-8 w-full rounded-md border border-input bg-background px-2 text-[12.5px] outline-none focus:border-ring"
          />
          <div className="max-h-48 overflow-y-auto">
            <button
              type="button"
              onClick={() => select(null)}
              className="flex w-full items-center rounded-md px-2 py-1.5 text-start text-[12.5px] text-muted-foreground hover:bg-muted"
            >
              {clearLabel ?? "—"}
            </button>
            {filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => select(option.value)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-start text-[12.5px] hover:bg-muted"
              >
                <span className="truncate">{option.label}</span>
                {option.value === value && (
                  <Check
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className="h-3.5 w-3.5 shrink-0 text-primary"
                  />
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-2 py-1.5 text-[12.5px] text-muted-foreground">
                {noResultsLabel ?? "No results"}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

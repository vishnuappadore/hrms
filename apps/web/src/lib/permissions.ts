"use client";

import { useMe } from "@/lib/queries/users";

/**
 * The signed-in user's permission keys, for client-side UI hiding only — never a security
 * boundary (the API's own @Permissions() guards are what actually enforce access). Returns `[]`
 * while `useMe()` is still loading, so a gated item never flashes visible before hiding.
 */
export function usePermissions(): string[] {
  const { data: me } = useMe();
  return me?.permissions ?? [];
}

/** Convenience single-key check — use `usePermissions()` directly when filtering a list, since
 *  hooks can't be called per-item inside a `.map()`. */
export function useHasPermission(key: string): boolean {
  return usePermissions().includes(key);
}

import { twMerge } from "tailwind-merge";

/** Join truthy class fragments and resolve conflicting Tailwind utilities (caller's className wins). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return twMerge(parts.filter(Boolean).join(" "));
}

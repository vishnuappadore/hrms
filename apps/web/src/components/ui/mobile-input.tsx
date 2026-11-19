"use client";

import { useState } from "react";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Input } from "./input";
import { Select } from "./select";

/**
 * Dial-code + local-number picker — a UX convenience only (defaults from the tenant's currency;
 * there is no literal tenant/company "country" field anywhere in the schema today). Validation
 * stays the shared, country-agnostic `MobileSchema` (docs/GLOBALIZATION.md) — this component only
 * ever produces/parses the single `+<dialcode><digits>` string that schema expects.
 */
export interface CountryOption {
  iso: string;
  dialCode: string;
}

export const COUNTRIES: CountryOption[] = [
  { iso: "om", dialCode: "968" },
  { iso: "ae", dialCode: "971" },
  { iso: "sa", dialCode: "966" },
  { iso: "qa", dialCode: "974" },
  { iso: "kw", dialCode: "965" },
  { iso: "bh", dialCode: "973" },
  { iso: "in", dialCode: "91" },
  { iso: "us", dialCode: "1" },
];

export const CURRENCY_TO_COUNTRY: Record<string, string> = {
  OMR: "om",
  AED: "ae",
  SAR: "sa",
  QAR: "qa",
  KWD: "kw",
  BHD: "bh",
  USD: "us",
};
export const DEFAULT_COUNTRY_ISO = "om";

export function findCountryByIso(iso: string): CountryOption {
  return COUNTRIES.find((c) => c.iso === iso) ?? COUNTRIES[0]!;
}

/** Splits an existing `+<dialcode><digits>` mobile into its picker parts, longest dial code
 *  first so e.g. a 3-digit code never gets mis-matched by a shorter one. Returns null when the
 *  stored number doesn't start with any known code (legacy data) — caller falls back gracefully. */
export function parseMobile(mobile: string): { dialCode: string; localNumber: string } | null {
  const digits = mobile.replace(/^\+/, "");
  const byLongestCode = [...COUNTRIES].sort((a, b) => b.dialCode.length - a.dialCode.length);
  for (const c of byLongestCode) {
    if (digits.startsWith(c.dialCode)) {
      return { dialCode: c.dialCode, localNumber: digits.slice(c.dialCode.length) };
    }
  }
  return null;
}

export interface MobileInputProps {
  id?: string;
  /** Full `+968XXXXXXXX`, or `""` for a new/empty record. */
  value: string;
  onChange: (mobile: string) => void;
  /** Tenant currency (`me.currency`) — picks the default dial code only when `value` is empty. */
  defaultCurrency?: string;
  "aria-label"?: string;
}

export function MobileInput({ id, value, onChange, defaultCurrency, "aria-label": ariaLabel }: MobileInputProps) {
  const tc = useTranslations("common");
  const parsedExisting = value ? parseMobile(value) : null;
  const defaultIso = CURRENCY_TO_COUNTRY[defaultCurrency ?? ""] ?? DEFAULT_COUNTRY_ISO;
  const [dialCode, setDialCode] = useState(
    parsedExisting?.dialCode ?? findCountryByIso(defaultIso).dialCode,
  );
  const [localNumber, setLocalNumber] = useState(parsedExisting?.localNumber ?? "");

  // Keeps the caller's single `mobile` value in sync with the two picker controls, which aren't
  // registered form fields themselves. Emits "" (not "+968") when empty, so optional fields
  // submit cleanly and required fields naturally fail MobileSchema's length check.
  // onChange is deliberately excluded — it's a fresh inline callback from the caller on every
  // render, including it would re-fire this effect (and the caller's onChange) every render.
  useEffect(() => {
    onChange(localNumber ? `+${dialCode}${localNumber}` : "");
  }, [dialCode, localNumber]);

  return (
    <div className="flex gap-2">
      <Select
        aria-label={ariaLabel ?? tc("dialCode")}
        value={dialCode}
        onChange={(e) => setDialCode(e.target.value)}
        className="w-36 shrink-0"
      >
        {COUNTRIES.map((c) => (
          <option key={c.iso} value={c.dialCode}>
            +{c.dialCode} {tc(`countries.${c.iso}`)}
          </option>
        ))}
      </Select>
      <Input
        id={id}
        dir="ltr"
        inputMode="numeric"
        placeholder="9XXX XXXX"
        value={localNumber}
        onChange={(e) => setLocalNumber(e.target.value.replace(/\D/g, ""))}
        className="flex-1"
      />
    </div>
  );
}

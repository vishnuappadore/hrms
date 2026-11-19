import { cookies } from "next/headers";

/**
 * Session cookies — httpOnly so tokens never touch client JS (XSS-safe).
 * hr_access:  short-lived JWT the proxy forwards as Bearer.
 * hr_refresh: opaque rotating token, path-limited to the BFF routes.
 */
const ACCESS_COOKIE = "hr_access";
const REFRESH_COOKIE = "hr_refresh";

// COOKIE_SECURE overrides the NODE_ENV-based default — set to "false" by the infra's
// deploy.sh only in the pre-domain/plain-HTTP tier (see infra/deploy.sh), where
// NODE_ENV=production but there is no TLS yet and a `Secure` cookie would be silently
// dropped by the browser. Once a real domain/TLS is configured, deploy.sh omits it and
// this reverts to the normal production => secure default.
function resolveSecureCookieFlag(): boolean {
  if (process.env.COOKIE_SECURE === "false") return false;
  if (process.env.COOKIE_SECURE === "true") return true;
  return process.env.NODE_ENV === "production";
}

const base = {
  httpOnly: true,
  secure: resolveSecureCookieFlag(),
  sameSite: "lax" as const,
  path: "/",
};

export async function setSessionCookies(tokens: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}) {
  const store = await cookies();
  store.set(ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: tokens.expiresIn });
  store.set(REFRESH_COOKIE, tokens.refreshToken, { ...base, maxAge: 60 * 60 * 24 * 30 });
}

export async function clearSessionCookies() {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}

export async function getAccessToken(): Promise<string | undefined> {
  return (await cookies()).get(ACCESS_COOKIE)?.value;
}

export async function getRefreshToken(): Promise<string | undefined> {
  return (await cookies()).get(REFRESH_COOKIE)?.value;
}

export function apiUrl(path: string): string {
  const baseUrl = process.env.API_URL ?? "http://localhost:4000";
  return `${baseUrl}${path}`;
}

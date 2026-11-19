import { cookies } from "next/headers";

/**
 * Session cookies — httpOnly so tokens never touch client JS (XSS-safe).
 * hr_access:  short-lived JWT the proxy forwards as Bearer.
 * hr_refresh: opaque rotating token, path-limited to the BFF routes.
 */
const ACCESS_COOKIE = "hr_access";
const REFRESH_COOKIE = "hr_refresh";

const base = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
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

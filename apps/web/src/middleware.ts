import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

const PUBLIC_PAGES = ["/login", "/forgot-password", "/reset-password"];

/**
 * Locale routing + a cheap auth gate: dashboard pages require the access
 * cookie to exist. Real authorization always happens in the API — this only
 * prevents an obviously-logged-out user from seeing the shell flash.
 */
export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic = PUBLIC_PAGES.some(
    (p) => pathname.endsWith(p) || pathname.includes(`${p}/`),
  );
  const hasSession = req.cookies.has("hr_refresh");

  if (!isPublic && !hasSession) {
    const locale = routing.locales.find((l) => pathname.startsWith(`/${l}`)) ?? routing.defaultLocale;
    const loginUrl = new URL(`/${locale}/login`, req.url);
    return NextResponse.redirect(loginUrl);
  }
  if (isPublic && hasSession) {
    const locale = routing.locales.find((l) => pathname.startsWith(`/${l}`)) ?? routing.defaultLocale;
    return NextResponse.redirect(new URL(`/${locale}/dashboard`, req.url));
  }

  return intlMiddleware(req);
}

export const config = {
  // all pages except Next internals, static files and the /api routes
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};

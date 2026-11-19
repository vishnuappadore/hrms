import { NextResponse } from "next/server";
import { apiUrl, clearSessionCookies, getRefreshToken } from "@/lib/session";

export async function POST() {
  const refreshToken = await getRefreshToken();
  if (refreshToken) {
    await fetch(apiUrl("/api/v1/auth/logout"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    }).catch(() => undefined);
  }
  await clearSessionCookies();
  return NextResponse.json({ ok: true });
}

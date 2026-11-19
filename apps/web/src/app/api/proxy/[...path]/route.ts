import { NextRequest, NextResponse } from "next/server";
import {
  apiUrl,
  getAccessToken,
  getRefreshToken,
  setSessionCookies,
} from "@/lib/session";

/**
 * BFF proxy: the browser calls /api/proxy/<path>, we forward to the NestJS API
 * with the Bearer token from the httpOnly cookie. On 401 we try one refresh
 * (rotating the cookie pair) and retry once. Mobile apps skip this entirely
 * and call the API directly — see docs/FRONTEND.md.
 */
async function handle(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const target = apiUrl(`/api/v1/${path.join("/")}${req.nextUrl.search}`);

  const body =
    req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();

  const forward = (token?: string) =>
    fetch(target, {
      method: req.method,
      headers: {
        ...(req.headers.get("content-type")
          ? { "content-type": req.headers.get("content-type")! }
          : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body,
      cache: "no-store",
    });

  let res = await forward(await getAccessToken());

  if (res.status === 401) {
    const refreshToken = await getRefreshToken();
    if (refreshToken) {
      const refreshRes = await fetch(apiUrl("/api/v1/auth/refresh"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
      });
      if (refreshRes.ok) {
        const tokens = await refreshRes.json();
        await setSessionCookies(tokens);
        res = await forward(tokens.accessToken);
      }
    }
  }

  const resBody = await res.arrayBuffer();
  return new NextResponse(resBody, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
    },
  });
}

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
};

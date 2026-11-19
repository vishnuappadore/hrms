import { NextRequest, NextResponse } from "next/server";
import { apiUrl, setSessionCookies } from "@/lib/session";

/** BFF login: forwards credentials to the API, stores tokens in httpOnly cookies. */
export async function POST(req: NextRequest) {
  const body = await req.json();

  let apiRes: Response;
  try {
    apiRes = await fetch(apiUrl("/api/v1/auth/login"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { statusCode: 503, code: "NETWORK", message: "Unable to connect" },
      { status: 503 },
    );
  }

  const data = await apiRes.json();
  if (!apiRes.ok) {
    return NextResponse.json(data, { status: apiRes.status });
  }

  await setSessionCookies(data.tokens);
  // tokens stay server-side; the client only gets the user profile
  return NextResponse.json({ user: data.user });
}

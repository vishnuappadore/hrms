"use client";

/**
 * Browser-side fetch wrapper: everything goes through the BFF proxy so tokens
 * stay in httpOnly cookies. Throws ApiError with the stable `code` from the
 * API contract — UI maps codes to localized messages, never raw messages.
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/proxy${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Unable to connect");
  }

  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.code ?? "ERROR", body.message ?? "Request failed", body.details);
  }
  return body as T;
}

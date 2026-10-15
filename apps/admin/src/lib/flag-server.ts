import type { Flag } from "@toggle-workflow/sdk";

// Server-side only: imported by Server Components and Server Actions, never by
// client components, so the server URL (and in phase 2 the admin token) stays
// off the browser.
export const FLAG_SERVER_URL = (process.env.FLAG_SERVER_URL ?? "http://localhost:4000").replace(/\/+$/, "");

export type AdminFlag = Flag & { stale: boolean };

export interface ApiError {
  code: string;
  message: string;
  details?: Array<{ field: string; message: string }>;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

export interface FlagInput {
  key?: string;
  description: string;
  owner: string;
  expiresAt: string;
  rolloutPercent: number;
  targetCustomers: string[];
  enabled?: boolean;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${FLAG_SERVER_URL}${path}`, {
      ...init,
      // Phase 2: add `Authorization: Bearer ${process.env.ADMIN_TOKEN}` here.
      headers: init.body ? { "content-type": "application/json" } : undefined,
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: {
        code: "UNREACHABLE",
        message: `Can't reach the flag server at ${FLAG_SERVER_URL}. Start it with \`pnpm dev\` or set FLAG_SERVER_URL.`,
      },
    };
  }
  if (response.status === 204) return { ok: true, data: undefined as T };
  const body = (await response.json().catch(() => null)) as { error?: ApiError } | null;
  if (response.ok) return { ok: true, data: body as T };
  return {
    ok: false,
    status: response.status,
    error: body?.error ?? { code: "BAD_RESPONSE", message: `The flag server answered ${response.status}.` },
  };
}

const path = (key: string) => `/v1/admin/flags/${encodeURIComponent(key)}`;

export const flagServer = {
  list: (includeArchived: boolean) =>
    call<AdminFlag[]>(`/v1/admin/flags${includeArchived ? "?includeArchived=true" : ""}`),
  get: (key: string) => call<AdminFlag>(path(key)),
  create: (input: FlagInput) => call<AdminFlag>("/v1/admin/flags", { method: "POST", body: JSON.stringify(input) }),
  update: (key: string, patch: Partial<FlagInput>) =>
    call<AdminFlag>(path(key), { method: "PATCH", body: JSON.stringify(patch) }),
  archive: (key: string) => call<void>(path(key), { method: "DELETE" }),
};

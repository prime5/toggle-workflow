"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { flagServer, type FlagInput } from "@/lib/flag-server";
import { dateToIso, parseCustomers, toFormState, type FormState } from "@/lib/form";

function readForm(formData: FormData): FlagInput {
  const text = (name: string) => String(formData.get(name) ?? "").trim();
  return {
    description: text("description"),
    owner: text("owner"),
    expiresAt: dateToIso(text("expiresAt")),
    rolloutPercent: Number(text("rolloutPercent") || "0"),
    targetCustomers: parseCustomers(String(formData.get("targetCustomers") ?? "")),
  };
}

export async function createFlag(_prev: FormState, formData: FormData): Promise<FormState> {
  const key = String(formData.get("key") ?? "").trim();
  const result = await flagServer.create({ ...readForm(formData), key, enabled: formData.get("enabled") === "on" });
  if (!result.ok) return toFormState(result.error);
  redirect(`/flags/${encodeURIComponent(key)}`);
}

export async function updateFlag(key: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const patch: Partial<FlagInput> = readForm(formData);
  // The server rejects a past expiry, so resending an unchanged one would make
  // a stale flag impossible to edit (e.g. to lower its rollout).
  if (patch.expiresAt === dateToIso(String(formData.get("originalExpiresAt") ?? ""))) delete patch.expiresAt;
  const result = await flagServer.update(key, patch);
  if (!result.ok) return toFormState(result.error);
  refresh();
  return { status: "saved", message: "Saved.", fieldErrors: {} };
}

/** Kill switch and its reverse. Returns an error message, or null on success. */
export async function setEnabled(key: string, enabled: boolean): Promise<string | null> {
  const result = await flagServer.update(key, { enabled });
  if (!result.ok) return result.error.message;
  refresh();
  return null;
}

export async function archiveFlag(key: string): Promise<string | null> {
  const result = await flagServer.archive(key);
  if (!result.ok) return result.error.message;
  redirect("/");
}

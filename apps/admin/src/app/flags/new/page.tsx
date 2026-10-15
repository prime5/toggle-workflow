import { connection } from "next/server";
import { Suspense } from "react";
import { createFlag } from "@/app/actions";
import { FlagForm } from "@/components/flag-form";

export default function NewFlagPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">New flag</h1>
      <Suspense fallback={null}>
        <NewFlagForm />
      </Suspense>
    </div>
  );
}

// The default expiry depends on today's date, so this renders per request.
async function NewFlagForm() {
  await connection();
  const inNinetyDays = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  return (
    <FlagForm
      mode="create"
      action={createFlag}
      initial={{ key: "", description: "", owner: "", expiresAt: inNinetyDays, rolloutPercent: 0, targetCustomers: [] }}
    />
  );
}

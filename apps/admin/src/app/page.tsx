import Link from "next/link";
import { Suspense } from "react";
import { setEnabled } from "@/app/actions";
import { formatDate, StatusBadges } from "@/components/flag-badges";
import { KillSwitch } from "@/components/kill-switch";
import { flagServer } from "@/lib/flag-server";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function FlagsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Flags</h1>
      {/* Flags are read fresh on every request, so the list streams in behind the static shell. */}
      <Suspense fallback={<p className="text-sm text-[var(--muted)]">Loading flags…</p>}>
        <FlagTable searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function FlagTable({ searchParams }: { searchParams: SearchParams }) {
  const showArchived = (await searchParams).archived === "1";
  const result = await flagServer.list(showArchived);

  const filter = (
    <Link href={showArchived ? "/" : "/?archived=1"} className="text-sm text-[var(--accent)] underline-offset-2 hover:underline">
      {showArchived ? "Hide archived flags" : "Show archived flags"}
    </Link>
  );

  if (!result.ok) {
    return (
      <p role="alert" className="notice notice-error">
        {result.error.message}
      </p>
    );
  }
  if (result.data.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {filter}
        <p className="text-[var(--muted)]">
          No flags yet. <Link href="/flags/new" className="text-[var(--accent)]">Create the first one.</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">{filter}</div>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Key</th>
              <th className="px-4 py-3 font-medium">Owner</th>
              <th className="px-4 py-3 font-medium">Rollout</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium">State</th>
            </tr>
          </thead>
          <tbody>
            {result.data.map((flag) => (
              <tr key={flag.key} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/flags/${flag.key}`} className="font-mono font-medium text-[var(--accent)] hover:underline">
                      {flag.key}
                    </Link>
                    <StatusBadges flag={flag} />
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{flag.description}</p>
                </td>
                <td className="whitespace-nowrap px-4 py-3">{flag.owner}</td>
                <td className="px-4 py-3 tabular-nums">{flag.rolloutPercent}%</td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatDate(flag.expiresAt)}</td>
                <td className="px-4 py-3">
                  {flag.archivedAt ? (
                    <span className="badge badge-off">Off</span>
                  ) : (
                    <KillSwitch flagKey={flag.key} enabled={flag.enabled} action={setEnabled} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

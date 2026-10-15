import type { AdminFlag } from "@/lib/flag-server";

export function StatusBadges({ flag }: { flag: AdminFlag }) {
  return (
    <>
      {flag.stale && !flag.archivedAt && (
        <span className="badge badge-stale" title="Past its expiry date: ship it or remove it">
          Stale
        </span>
      )}
      {flag.archivedAt && <span className="badge badge-off">Archived</span>}
    </>
  );
}

export const formatDate = (iso: string) => iso.slice(0, 10);

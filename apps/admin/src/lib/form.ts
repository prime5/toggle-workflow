// Pure helpers shared by the Server Actions and the client form. No server or
// browser APIs here, so they are unit-testable.

export const FIELDS = ["key", "description", "owner", "expiresAt", "rolloutPercent", "targetCustomers"] as const;
export type Field = (typeof FIELDS)[number];

export interface FormState {
  status: "idle" | "error" | "saved";
  /** Problem that isn't about one field (duplicate key, server down). */
  message?: string;
  fieldErrors: Partial<Record<Field, string>>;
}

export const idleState: FormState = { status: "idle", fieldErrors: {} };

/** Comma- or newline-separated customer IDs, trimmed, empties and repeats dropped. */
export function parseCustomers(raw: string): string[] {
  return [...new Set(raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean))];
}

/** "2027-01-31" -> "2027-01-31T00:00:00.000Z"; anything else is passed through for the server to reject. */
export function dateToIso(raw: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw;
}

// What to fix, per field. Shown instead of raw schema messages like
// `must match pattern "^[a-z0-9]..."`.
const HINTS: Record<Field, string> = {
  key: "Use 2–63 characters: lowercase letters, digits and hyphens, starting with a letter or digit.",
  description: "Describe what the flag controls.",
  owner: "Enter the person or team who owns this flag.",
  expiresAt: "Pick an expiry date.",
  rolloutPercent: "Choose a rollout between 0 and 100%.",
  targetCustomers: "List customer IDs separated by commas or new lines.",
};

const TOP_LEVEL: Record<string, string> = {
  FLAG_EXISTS: "A flag with this key already exists. Choose another key.",
  FLAG_ARCHIVED: "An archived flag already uses this key. Keys can't be reused; choose another.",
  NOT_FOUND: "This flag no longer exists.",
};

function isField(name: string): name is Field {
  return (FIELDS as readonly string[]).includes(name);
}

/** Maps the server's `{ error: { code, message, details } }` onto form fields. */
export function toFormState(error: { code: string; message: string; details?: Array<{ field: string; message: string }> }): FormState {
  const fieldErrors: FormState["fieldErrors"] = {};
  const unplaced: string[] = [];
  for (const detail of error.details ?? []) {
    const name = detail.field.split("/").filter(Boolean)[0] ?? "";
    if (!isField(name)) {
      unplaced.push(detail.message);
      continue;
    }
    if (fieldErrors[name]) continue;
    fieldErrors[name] =
      error.code === "INVALID_EXPIRY" ? "Pick a date in the future." : HINTS[name];
  }
  const placed = Object.keys(fieldErrors).length > 0;
  const message =
    TOP_LEVEL[error.code] ??
    (unplaced.length ? unplaced.join(" ") : placed ? "Fix the highlighted fields and save again." : error.message);
  return { status: "error", message, fieldErrors };
}

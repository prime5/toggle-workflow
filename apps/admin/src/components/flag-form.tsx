"use client";

import { startTransition, useActionState, useId, useState, type FormEvent, type ReactNode } from "react";
import { idleState, type Field, type FormState } from "@/lib/form";

export interface FlagFormValues {
  key: string;
  description: string;
  owner: string;
  expiresAt: string; // YYYY-MM-DD
  rolloutPercent: number;
  targetCustomers: string[];
}

interface Props {
  mode: "create" | "edit";
  initial: FlagFormValues;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}

export function FlagForm({ mode, initial, action }: Props) {
  const [state, dispatch, pending] = useActionState(action, idleState);
  const [rollout, setRollout] = useState(initial.rolloutPercent);

  // Submitting through startTransition rather than <form action> keeps what the
  // user typed when the server rejects it (React resets action-driven forms).
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  }

  const error = (field: Field) => state.fieldErrors[field];

  return (
    // noValidate: the server's schema is the single source of truth; its
    // errors are shown next to each field below.
    <form onSubmit={onSubmit} noValidate className="flex max-w-xl flex-col gap-5">
      {state.message && (
        <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "notice notice-error" : "notice notice-ok"}>
          {state.message}
        </p>
      )}

      {mode === "create" ? (
        <TextField name="key" label="Key" defaultValue={initial.key} error={error("key")} hint='Used in code as useFlag("key"). Cannot be changed later.' mono />
      ) : (
        <input type="hidden" name="originalExpiresAt" value={initial.expiresAt} />
      )}
      <TextField name="description" label="Description" defaultValue={initial.description} error={error("description")} />
      <TextField name="owner" label="Owner" defaultValue={initial.owner} error={error("owner")} hint="Person or team accountable for cleanup." />
      <TextField name="expiresAt" label="Expires" type="date" defaultValue={initial.expiresAt} error={error("expiresAt")} hint="After this date the flag is marked stale." />

      <Labeled name="rolloutPercent" label={`Rollout: ${rollout}%`} error={error("rolloutPercent")}>
        {(props) => (
          <input
            {...props}
            type="range"
            min={0}
            max={100}
            step={1}
            value={rollout}
            onChange={(e) => setRollout(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
        )}
      </Labeled>

      <Labeled name="targetCustomers" label="Target customers" error={error("targetCustomers")} hint="Always on for these customer IDs, whatever the rollout. Comma or newline separated.">
        {(props) => <textarea {...props} rows={3} defaultValue={initial.targetCustomers.join("\n")} className="input font-mono" />}
      </Labeled>

      {mode === "create" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" /> Turn on now
        </label>
      )}

      <div>
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Saving…" : mode === "create" ? "Create flag" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

type ControlProps = { id: string; name: string; "aria-invalid"?: boolean; "aria-describedby"?: string };

function Labeled({ name, label, error, hint, children }: { name: string; label: string; error?: string; hint?: string; children: (props: ControlProps) => ReactNode }) {
  const id = useId();
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({ id, name, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {error && (
        <p id={`${id}-error`} className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-[var(--muted)]">
          {hint}
        </p>
      )}
    </div>
  );
}

function TextField(props: { name: Field; label: string; defaultValue: string; error?: string; hint?: string; type?: string; mono?: boolean }) {
  return (
    <Labeled name={props.name} label={props.label} error={props.error} hint={props.hint}>
      {(control) => <input {...control} type={props.type ?? "text"} defaultValue={props.defaultValue} className={`input ${props.mono ? "font-mono" : ""}`} />}
    </Labeled>
  );
}

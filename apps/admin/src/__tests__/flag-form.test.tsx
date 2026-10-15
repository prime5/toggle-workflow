import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlagForm, type FlagFormValues } from "@/components/flag-form";
import { toFormState, type FormState } from "@/lib/form";

afterEach(cleanup);

const blank: FlagFormValues = { key: "", description: "", owner: "", expiresAt: "2027-01-01", rolloutPercent: 0, targetCustomers: [] };

async function submit(button = "Create flag") {
  await act(async () => void fireEvent.click(screen.getByRole("button", { name: button })));
}

// The server's real response for { key: "Bad Key", rolloutPercent: 101 } (see server tests).
const serverValidationError = {
  code: "VALIDATION_ERROR",
  message: "Request validation failed",
  details: [
    { field: "/key", message: 'must match pattern "^[a-z0-9][a-z0-9-]{1,62}$"' },
    { field: "/rolloutPercent", message: "must be <= 100" },
    { field: "/owner", message: "must have required property 'owner'" },
  ],
};

describe("FlagForm error display", () => {
  it("shows each server error next to its field, saying what to fix", async () => {
    const action = vi.fn(async (): Promise<FormState> => toFormState(serverValidationError));
    render(<FlagForm mode="create" initial={blank} action={action} />);
    await submit();

    const key = screen.getByLabelText("Key");
    expect(key.getAttribute("aria-invalid")).toBe("true");
    const keyError = document.getElementById(key.getAttribute("aria-describedby")!.split(" ")[0]!);
    expect(keyError?.textContent).toMatch(/lowercase letters, digits and hyphens/);

    expect(screen.getByLabelText("Owner").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter the person or team who owns this flag.")).toBeTruthy();
    expect(screen.getByText("Choose a rollout between 0 and 100%.")).toBeTruthy();
    expect(screen.getByLabelText("Description").getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("Fix the highlighted fields and save again.");
  });

  it("keeps what the user typed when the server rejects it", async () => {
    render(<FlagForm mode="create" initial={blank} action={async () => toFormState(serverValidationError)} />);
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "Bad Key" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "New checkout" } });
    await submit();
    expect((screen.getByLabelText("Key") as HTMLInputElement).value).toBe("Bad Key");
    expect((screen.getByLabelText("Description") as HTMLInputElement).value).toBe("New checkout");
  });

  it("sends the form fields to the action", async () => {
    const action = vi.fn(async (_state: FormState, _formData: FormData): Promise<FormState> => ({ status: "idle", fieldErrors: {} }));
    render(<FlagForm mode="create" initial={blank} action={action} />);
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "new-checkout" } });
    fireEvent.change(screen.getByLabelText("Rollout: 0%"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("Target customers"), { target: { value: "acme, globex" } });
    await submit();
    const formData = action.mock.calls[0]![1];
    expect(formData.get("key")).toBe("new-checkout");
    expect(formData.get("rolloutPercent")).toBe("25");
    expect(formData.get("targetCustomers")).toBe("acme, globex");
  });

  it("explains an expiry in the past and a duplicate key", async () => {
    render(
      <FlagForm
        mode="create"
        initial={blank}
        action={async () =>
          toFormState({ code: "INVALID_EXPIRY", message: "expiresAt must be in the future", details: [{ field: "/expiresAt", message: "x" }] })
        }
      />,
    );
    await submit();
    expect(screen.getByText("Pick a date in the future.")).toBeTruthy();

    cleanup();
    render(<FlagForm mode="create" initial={blank} action={async () => toFormState({ code: "FLAG_EXISTS", message: "exists" })} />);
    await submit();
    expect(screen.getByRole("alert").textContent).toBe("A flag with this key already exists. Choose another key.");
  });
});

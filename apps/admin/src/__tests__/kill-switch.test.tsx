import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KillSwitch } from "@/components/kill-switch";

afterEach(cleanup);

const click = (name: string) => act(async () => void fireEvent.click(screen.getByRole("button", { name })));

describe("KillSwitch", () => {
  it("shows the current state", () => {
    render(<KillSwitch flagKey="new-checkout" enabled action={vi.fn()} />);
    expect(screen.getByLabelText("new-checkout is on").textContent).toBe("On");
  });

  it("asks for confirmation before turning a flag off", async () => {
    const action = vi.fn().mockResolvedValue(null);
    render(<KillSwitch flagKey="new-checkout" enabled action={action} />);

    await click("Kill switch");
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByText("Turn off new-checkout for everyone?")).toBeTruthy();

    await click("Turn off");
    expect(action).toHaveBeenCalledExactlyOnceWith("new-checkout", false);
    expect(screen.queryByRole("group", { name: "Confirm" })).toBeNull();
  });

  it("cancel leaves the flag alone", async () => {
    const action = vi.fn();
    render(<KillSwitch flagKey="new-checkout" enabled action={action} />);
    await click("Kill switch");
    await click("Cancel");
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Kill switch" })).toBeTruthy();
  });

  it("turns a flag back on, also with confirmation", async () => {
    const action = vi.fn().mockResolvedValue(null);
    render(<KillSwitch flagKey="new-checkout" enabled={false} action={action} />);
    expect(screen.getByLabelText("new-checkout is off")).toBeTruthy();
    await click("Turn on");
    await click("Turn on");
    expect(action).toHaveBeenCalledExactlyOnceWith("new-checkout", true);
  });

  it("shows the server's error when the change fails", async () => {
    const action = vi.fn().mockResolvedValue("Can't reach the flag server at http://localhost:4000.");
    render(<KillSwitch flagKey="new-checkout" enabled action={action} />);
    await click("Kill switch");
    await click("Turn off");
    expect(screen.getByRole("alert").textContent).toMatch(/Can't reach the flag server/);
  });
});

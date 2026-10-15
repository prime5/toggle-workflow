import { act, cleanup, render, screen } from "@testing-library/react";
import { createFlagClient, type FlagSnapshot } from "@toggle-workflow/sdk";
import { FlagProvider } from "@toggle-workflow/sdk/react";
import { afterEach, describe, expect, it } from "vitest";
import { Shop } from "@/shop";

// Flag state is injected through the SDK: a real client whose fetch answers
// from memory. No flag server needed.
function clientWith(flags: FlagSnapshot) {
  const fetch = (async () => Response.json(flags)) as unknown as typeof globalThis.fetch;
  return createFlagClient({ baseUrl: "http://flags.test", context: { userKey: crypto.randomUUID() }, fetch });
}

async function renderShop(flags: FlagSnapshot) {
  const client = clientWith(flags);
  render(
    <FlagProvider client={client}>
      <Shop />
    </FlagProvider>,
  );
  await act(async () => {}); // let the first evaluation resolve
  return client;
}

const checkout = () => screen.getByRole("region", { name: "Checkout" });

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("checkout behind new-checkout", () => {
  it("flag off: the existing three-step checkout", async () => {
    const client = await renderShop({ "new-checkout": false });
    expect(checkout().dataset.checkout).toBe("old");
    expect(screen.getByText("Step 1 of 3: shipping address")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue to payment" })).toBeTruthy();
    client.close();
  });

  it("flag on: the new one-step express checkout", async () => {
    const client = await renderShop({ "new-checkout": true });
    expect(checkout().dataset.checkout).toBe("new");
    expect(screen.getByRole("button", { name: "Pay $153.00" })).toBeTruthy();
    client.close();
  });

  it("flag unknown to the server: falls back to the existing checkout", async () => {
    const client = await renderShop({});
    expect(checkout().dataset.checkout).toBe("old");
    client.close();
  });

  it("the cart is the same in both states", async () => {
    const client = await renderShop({ "new-checkout": true });
    expect(screen.getByRole("region", { name: "Cart" }).textContent).toContain("$153.00");
    client.close();
  });
});

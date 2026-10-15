import { describe, expect, it } from "vitest";
import { rewrites } from "../../next.config";

describe("flag rewrite", () => {
  it("forwards only the evaluate endpoint to the flag server", async () => {
    expect(await rewrites()).toEqual([
      { source: "/flags/v1/evaluate", destination: "http://localhost:4000/v1/evaluate" },
    ]);
  });
});

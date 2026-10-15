import { describe, expect, it } from "vitest";
import { dateToIso, parseCustomers, toFormState } from "@/lib/form";

describe("form helpers", () => {
  it("parses customer IDs from commas and new lines, dropping blanks and repeats", () => {
    expect(parseCustomers(" acme,globex\n\nacme , initech ")).toEqual(["acme", "globex", "initech"]);
  });

  it("turns a date input into an ISO timestamp", () => {
    expect(dateToIso("2027-01-31")).toBe("2027-01-31T00:00:00.000Z");
    expect(dateToIso("")).toBe("");
  });

  it("uses the first segment of a nested field path", () => {
    const state = toFormState({
      code: "VALIDATION_ERROR",
      message: "x",
      details: [{ field: "/targetCustomers/1", message: "must NOT have duplicate items" }],
    });
    expect(Object.keys(state.fieldErrors)).toEqual(["targetCustomers"]);
  });

  it("falls back to the server message when no field matches", () => {
    expect(toFormState({ code: "UNREACHABLE", message: "Can't reach the flag server." }).message).toBe(
      "Can't reach the flag server.",
    );
  });
});

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { EvaluationContext, Flag } from "@toggle-workflow/sdk";
import { buildApp } from "./app.js";
import { evaluate } from "./evaluate.js";
import { SQLiteFlagStore } from "./store.js";

function makeFlag(overrides: Partial<Flag> = {}): Flag {
  const now = new Date().toISOString();
  return {
    key: "sample-flag",
    description: "A sample flag",
    owner: "team",
    expiresAt: "2027-01-01T00:00:00.000Z",
    enabled: true,
    rolloutPercent: 25,
    targetCustomers: [],
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides,
  };
}

function createApp() {
  const store = new SQLiteFlagStore(":memory:");
  const app = buildApp({ store });
  after(async () => {
    await app.close();
    store.close();
  });
  return app;
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    key: "checkout-v2",
    description: "New checkout",
    owner: "payments",
    expiresAt: "2027-01-01T00:00:00.000Z",
    enabled: true,
    rolloutPercent: 25,
    targetCustomers: [],
    ...overrides,
  };
}

describe("admin flag routes", () => {
  const app = createApp();

  it("creates, reads, lists, updates, and archives flags", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/admin/flags", payload: createBody() });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json<Flag>().enabled, true);
    assert.equal(created.json<Flag>().archivedAt, null);

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/admin/flags",
      payload: createBody(),
    });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(typeof duplicate.json().error.code, "string");

    const fetched = await app.inject({ method: "GET", url: "/v1/admin/flags/checkout-v2" });
    assert.equal(fetched.statusCode, 200);
    assert.equal(fetched.json<Flag>().key, "checkout-v2");

    const listed = await app.inject({ method: "GET", url: "/v1/admin/flags" });
    assert.equal(listed.json<Flag[]>()[0].key, "checkout-v2");

    const updated = await app.inject({
      method: "PATCH",
      url: "/v1/admin/flags/checkout-v2",
      payload: { rolloutPercent: 60 },
    });
    assert.equal(updated.json<Flag>().rolloutPercent, 60);

    const removed = await app.inject({ method: "DELETE", url: "/v1/admin/flags/checkout-v2" });
    assert.equal(removed.statusCode, 204);
  });

  it("rejects invalid keys, rollout values, and missing required creation fields", async () => {
    const invalidBodies = [
      createBody({ key: "Invalid_Key" }),
      createBody({ rolloutPercent: 101 }),
      createBody({ owner: undefined }),
      createBody({ expiresAt: undefined }),
    ];
    for (const payload of invalidBodies) {
      const response = await app.inject({ method: "POST", url: "/v1/admin/flags", payload });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, "VALIDATION_ERROR");
    }
  });

  it("returns 404 for missing flags and rejects immutable keys", async () => {
    const missing = await app.inject({ method: "GET", url: "/v1/admin/flags/missing-flag" });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.code, "NOT_FOUND");

    await app.inject({ method: "POST", url: "/v1/admin/flags", payload: createBody() });
    const immutableKey = await app.inject({
      method: "PATCH",
      url: "/v1/admin/flags/checkout-v2",
      payload: { key: "renamed-flag" },
    });
    assert.equal(immutableKey.statusCode, 400);
  });

  it("defaults new flags to dark with zero rollout and no customer targets", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/flags",
      payload: createBody({
        key: "dark-default",
        enabled: undefined,
        rolloutPercent: undefined,
        targetCustomers: undefined,
      }),
    });
    const flag = response.json<Flag>();
    assert.equal(response.statusCode, 201);
    assert.equal(flag.enabled, false);
    assert.equal(flag.rolloutPercent, 0);
    assert.deepEqual(flag.targetCustomers, []);
  });
});

describe("evaluation routes", () => {
  const app = createApp();

  it("omits archived flags from listing and evaluation", async () => {
    await app.inject({ method: "POST", url: "/v1/admin/flags", payload: createBody() });
    await app.inject({ method: "DELETE", url: "/v1/admin/flags/checkout-v2" });

    const listed = await app.inject({ method: "GET", url: "/v1/admin/flags" });
    const archived = await app.inject({
      method: "GET",
      url: "/v1/admin/flags?includeArchived=true",
    });
    const evaluated = await app.inject({
      method: "POST",
      url: "/v1/evaluate",
      payload: { context: { userKey: "user-1" } },
    });
    assert.deepEqual(listed.json(), []);
    assert.equal(archived.json<Flag[]>()[0].archivedAt !== null, true);
    assert.deepEqual(evaluated.json(), {});
  });

  it("validates evaluation context", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/evaluate",
      payload: { context: {} },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "VALIDATION_ERROR");
  });
});

describe("flag evaluation", () => {
  it("keeps a disabled flag off even for targeted customers at full rollout", () => {
    const flag = makeFlag({
      enabled: false,
      rolloutPercent: 100,
      targetCustomers: ["priority-customer"],
    });
    assert.equal(evaluate(flag, { userKey: "user-1", customerId: "priority-customer" }), false);
    assert.equal(evaluate(flag, { userKey: "user-2" }), false);
  });

  it("enables target customers at zero rollout", () => {
    const flag = makeFlag({ rolloutPercent: 0, targetCustomers: ["priority-customer"] });
    assert.equal(evaluate(flag, { userKey: "user-1", customerId: "priority-customer" }), true);
    assert.equal(evaluate(flag, { userKey: "user-2", customerId: "other-customer" }), false);
  });

  it("matches an explicitly supplied empty customer ID", () => {
    const flag = makeFlag({ rolloutPercent: 0, targetCustomers: [""] });
    assert.equal(evaluate(flag, { userKey: "user-1", customerId: "" }), true);
  });

  it("returns the same result for the same flag and user", () => {
    const flag = makeFlag();
    const context: EvaluationContext = { userKey: "stable-user" };
    assert.equal(evaluate(flag, context), evaluate(flag, context));
  });

  it("distributes 10,000 users within the 25 percent rollout range", () => {
    const flag = makeFlag({ rolloutPercent: 25 });
    let enabledCount = 0;
    for (let index = 0; index < 10_000; index += 1) {
      enabledCount += Number(evaluate(flag, { userKey: `user-${index}` }));
    }
    const percentage = (enabledCount / 10_000) * 100;
    assert.ok(percentage >= 23 && percentage <= 27, `${percentage}% enabled`);
  });

  it("uses independent user buckets across flag keys", () => {
    const firstFlag = makeFlag({ key: "first-flag", rolloutPercent: 50 });
    const secondFlag = makeFlag({ key: "second-flag", rolloutPercent: 50 });
    let differingUsers = 0;
    for (let index = 0; index < 10_000; index += 1) {
      const context = { userKey: `user-${index}` };
      differingUsers += Number(evaluate(firstFlag, context) !== evaluate(secondFlag, context));
    }
    const percentage = (differingUsers / 10_000) * 100;
    assert.ok(percentage >= 45 && percentage <= 55, `${percentage}% differ`);
  });
});

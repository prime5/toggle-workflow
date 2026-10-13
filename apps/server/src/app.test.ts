import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, describe, it } from "node:test";
import type { EvaluationContext, Flag } from "@toggle-workflow/sdk";
import { buildApp } from "./app.js";
import { evaluate } from "./evaluate.js";
import { registerShutdownHandlers } from "./shutdown.js";
import { SQLiteFlagStore, type FlagStore } from "./store.js";

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

function createApp(store: FlagStore = new SQLiteFlagStore(":memory:")) {
  const app = buildApp({ store });
  after(async () => {
    await app.close();
    if (store instanceof SQLiteFlagStore) store.close();
  });
  return { app, store };
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
  const { app } = createApp();
  const staleStore = new SQLiteFlagStore(":memory:");
  const { app: staleApp } = createApp(staleStore);

  it("creates, reads, lists, updates, and archives flags", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/admin/flags", payload: createBody() });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json<Flag>().enabled, true);
    assert.equal(created.json<Flag>().archivedAt, null);
    assert.equal(created.json().stale, false);

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
    assert.equal(updated.json().stale, false);

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

  it("returns a validation detail for invalid requests", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/flags",
      payload: createBody({ rolloutPercent: 101 }),
    });
    const error = response.json().error;
    assert.equal(response.statusCode, 400);
    assert.equal(error.code, "VALIDATION_ERROR");
    assert.ok(Array.isArray(error.details));
    assert.equal(error.details[0].field, "/rolloutPercent");
    assert.match(error.details[0].message, /must be/);
  });

  it("maps malformed JSON to our INVALID_JSON code and preserves Fastify's message", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/flags",
      headers: { "content-type": "application/json" },
      payload: "{invalid",
    });
    const error = response.json().error;
    assert.equal(response.statusCode, 400);
    assert.equal(error.code, "INVALID_JSON");
    assert.match(error.message, /JSON|Unexpected|property/i);
  });

  it("maps unsupported media types to our own error code", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/flags",
      headers: { "content-type": "application/xml" },
      payload: "not json",
    });
    assert.equal(response.statusCode, 415, JSON.stringify(response.json()));
    assert.equal(response.json().error.code, "UNSUPPORTED_MEDIA_TYPE");
    assert.match(response.json().error.message, /unsupported media type/i);
  });

  it("maps other Fastify 4xx errors to BAD_REQUEST without leaking their code", async () => {
    const teapot = Object.assign(new Error("I'm a teapot"), {
      statusCode: 418,
      code: "FST_ERR_EXAMPLE",
    });
    const failingStore: FlagStore = {
      create: () => { throw teapot; },
      get: () => undefined,
      list: () => { throw teapot; },
      update: () => undefined,
      archive: () => undefined,
    };
    const errorApp = buildApp({ store: failingStore });
    try {
      const response = await errorApp.inject({ method: "GET", url: "/v1/admin/flags" });
      assert.equal(response.statusCode, 418);
      assert.deepEqual(response.json().error, {
        code: "BAD_REQUEST",
        message: "I'm a teapot",
      });
    } finally {
      await errorApp.close();
    }
  });

  it("rejects an expired flag on create and PATCH", async () => {
    const expired = "2000-01-01T00:00:00.000Z";
    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/admin/flags",
      payload: createBody({ key: "expired-create", expiresAt: expired }),
    });
    assert.equal(createResponse.statusCode, 400);
    assert.equal(createResponse.json().error.code, "INVALID_EXPIRY");

    await app.inject({
      method: "POST",
      url: "/v1/admin/flags",
      payload: createBody({ key: "expiry-patch" }),
    });
    const patchResponse = await app.inject({
      method: "PATCH",
      url: "/v1/admin/flags/expiry-patch",
      payload: { expiresAt: expired },
    });
    assert.equal(patchResponse.statusCode, 400);
    assert.equal(patchResponse.json().error.code, "INVALID_EXPIRY");
  });

  it("rejects PATCH for archived flags and prevents reusing archived keys", async () => {
    await app.inject({ method: "POST", url: "/v1/admin/flags", payload: createBody() });
    await app.inject({ method: "DELETE", url: "/v1/admin/flags/checkout-v2" });

    const patchResponse = await app.inject({
      method: "PATCH",
      url: "/v1/admin/flags/checkout-v2",
      payload: { enabled: true },
    });
    assert.equal(patchResponse.statusCode, 409);
    assert.equal(patchResponse.json().error.code, "FLAG_ARCHIVED");

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/admin/flags",
      payload: createBody(),
    });
    assert.equal(createResponse.statusCode, 409);
    assert.equal(createResponse.json().error.code, "FLAG_ARCHIVED");
    assert.match(createResponse.json().error.message, /archived/i);
  });

  it("adds stale to GET and list responses for expired stored flags", async () => {
    staleStore.create({
      key: "old-flag",
      description: "Old flag",
      owner: "team",
      expiresAt: "2000-01-01T00:00:00.000Z",
    });

    const fetched = await staleApp.inject({ method: "GET", url: "/v1/admin/flags/old-flag" });
    const listed = await staleApp.inject({ method: "GET", url: "/v1/admin/flags" });
    assert.equal(fetched.json().stale, true);
    assert.equal(listed.json()[0].stale, true);
  });

  it("logs unexpected server errors and returns the generic 500 shape", async () => {
    const failingStore: FlagStore = {
      create: () => { throw new Error("database secret"); },
      get: () => undefined,
      list: () => { throw new Error("database secret"); },
      update: () => undefined,
      archive: () => undefined,
    };
    const loggerApp = buildApp({ store: failingStore, logger: true });
    try {
      const response = await loggerApp.inject({ method: "GET", url: "/v1/admin/flags" });
      assert.equal(response.statusCode, 500);
      assert.deepEqual(response.json().error, {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
    } finally {
      await loggerApp.close();
    }
  });

  it("rejects empty and duplicate target customer IDs", async () => {
    for (const targetCustomers of [[""], ["customer-1", "customer-1"]]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/admin/flags",
        payload: createBody({
          key: `target-${targetCustomers.length}-${targetCustomers[0] || "empty"}`,
          targetCustomers,
        }),
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, "VALIDATION_ERROR");
    }
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
  const { app } = createApp();

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

  it("rejects an empty customerId", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/evaluate",
      payload: { context: { userKey: "user-1", customerId: "" } },
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

describe("server shutdown", () => {
  it("closes the app and store on SIGINT or SIGTERM exactly once", async () => {
    const signals = new EventEmitter();
    let appCloseCount = 0;
    let storeCloseCount = 0;
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    registerShutdownHandlers(
      {
        close: async () => {
          appCloseCount += 1;
        },
      },
      () => {
        storeCloseCount += 1;
        resolveClosed();
      },
      signals,
    );

    signals.emit("SIGTERM");
    await closed;
    signals.emit("SIGINT");
    await Promise.resolve();

    assert.equal(appCloseCount, 1);
    assert.equal(storeCloseCount, 1);
  });
});

import Fastify from "fastify";
import type { EvaluationContext, Flag, FlagSnapshot } from "@toggle-workflow/sdk";
import { evaluate } from "./evaluate.js";
import { DuplicateFlagError, type CreateFlagInput, type FlagPatch, type FlagStore } from "./store.js";

interface BuildAppOptions {
  store: FlagStore;
  logger?: boolean;
}

const keySchema = { type: "string", pattern: "^[a-z0-9][a-z0-9-]{1,62}$" } as const;
const expiresAtSchema = { type: "string", format: "date-time" } as const;
const mutableProperties = {
  description: { type: "string" },
  owner: { type: "string", minLength: 1 },
  expiresAt: expiresAtSchema,
  enabled: { type: "boolean" },
  rolloutPercent: { type: "integer", minimum: 0, maximum: 100 },
  targetCustomers: { type: "array", items: { type: "string" } },
} as const;

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export function buildApp({ store, logger = false }: BuildAppOptions) {
  const app = Fastify({ logger, ajv: { customOptions: { removeAdditional: false } } });

  app.setErrorHandler((error, _request, reply) => {
    const details = error as { validation?: unknown; statusCode?: number };
    const statusCode = details.validation ? 400 : details.statusCode ?? 500;
    const code = details.validation
      ? "VALIDATION_ERROR"
      : statusCode === 404
        ? "NOT_FOUND"
        : "INTERNAL_ERROR";
    const message = details.validation
      ? "Request validation failed"
      : statusCode === 404
        ? "Route not found"
        : "Internal server error";
    reply.code(statusCode).send(errorBody(code, message));
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send(errorBody("NOT_FOUND", "Route not found"));
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.post<{ Body: CreateFlagInput }>(
    "/v1/admin/flags",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["key", "description", "owner", "expiresAt"],
          properties: { key: keySchema, ...mutableProperties },
        },
      },
    },
    async (request, reply) => {
      try {
        const flag = store.create(request.body);
        return reply.code(201).send(flag);
      } catch (error) {
        if (error instanceof DuplicateFlagError) {
          return reply.code(409).send(errorBody("FLAG_EXISTS", error.message));
        }
        throw error;
      }
    },
  );

  app.get<{ Querystring: { includeArchived?: boolean } }>(
    "/v1/admin/flags",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { includeArchived: { type: "boolean" } },
        },
      },
    },
    async (request): Promise<Flag[]> => store.list(request.query.includeArchived ?? false),
  );

  app.get<{ Params: { key: string } }>(
    "/v1/admin/flags/:key",
    { schema: { params: { type: "object", required: ["key"], properties: { key: keySchema } } } },
    async (request, reply) => {
      const flag = store.get(request.params.key);
      if (!flag) {
        return reply.code(404).send(errorBody("NOT_FOUND", "Flag not found"));
      }
      return flag;
    },
  );

  app.patch<{ Params: { key: string }; Body: FlagPatch }>(
    "/v1/admin/flags/:key",
    {
      schema: {
        params: { type: "object", required: ["key"], properties: { key: keySchema } },
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: mutableProperties,
        },
      },
    },
    async (request, reply) => {
      const flag = store.update(request.params.key, request.body);
      if (!flag) {
        return reply.code(404).send(errorBody("NOT_FOUND", "Flag not found"));
      }
      return flag;
    },
  );

  app.delete<{ Params: { key: string } }>(
    "/v1/admin/flags/:key",
    { schema: { params: { type: "object", required: ["key"], properties: { key: keySchema } } } },
    async (request, reply) => {
      const flag = store.archive(request.params.key);
      if (!flag) {
        return reply.code(404).send(errorBody("NOT_FOUND", "Flag not found"));
      }
      return reply.code(204).send();
    },
  );

  app.post<{ Body: { context: EvaluationContext } }>(
    "/v1/evaluate",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["context"],
          properties: {
            context: {
              type: "object",
              additionalProperties: false,
              required: ["userKey"],
              properties: {
                userKey: { type: "string", minLength: 1 },
                customerId: { type: "string" },
              },
            },
          },
        },
      },
    },
    async (request): Promise<FlagSnapshot> => {
      const snapshot: FlagSnapshot = {};
      for (const flag of store.list()) {
        snapshot[flag.key] = evaluate(flag, request.body.context);
      }
      return snapshot;
    },
  );

  return app;
}
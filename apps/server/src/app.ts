import Fastify from "fastify";
import type { EvaluationContext, Flag, FlagSnapshot } from "@toggle-workflow/sdk";
import { evaluate } from "./evaluate.js";
import { DuplicateFlagError, type CreateFlagInput, type FlagPatch, type FlagStore } from "./store.js";

interface BuildAppOptions {
  store: FlagStore;
  logger?: boolean;
}

type AdminFlag = Flag & { stale: boolean };

const keySchema = { type: "string", pattern: "^[a-z0-9][a-z0-9-]{1,62}$" } as const;
const expiresAtSchema = { type: "string", format: "date-time" } as const;
const mutableProperties = {
  description: { type: "string" },
  owner: { type: "string", minLength: 1 },
  expiresAt: expiresAtSchema,
  enabled: { type: "boolean" },
  rolloutPercent: { type: "integer", minimum: 0, maximum: 100 },
  targetCustomers: {
    type: "array",
    uniqueItems: true,
    items: { type: "string", minLength: 1 },
  },
} as const;

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export function buildApp({ store, logger = false }: BuildAppOptions) {
  const app = Fastify({ logger, ajv: { customOptions: { removeAdditional: false } } });

  app.setErrorHandler((error, request, reply) => {
    const fastifyError = error as {
      code?: string;
      message: string;
      statusCode?: number;
      validation?: Array<{ instancePath?: string; message?: string }>;
    };
    const statusCode = fastifyError.statusCode ?? 500;

    if (statusCode >= 500) {
      request.log.error(error);
      return reply.code(statusCode).send(errorBody("INTERNAL_ERROR", "Internal server error"));
    }

    if (fastifyError.validation) {
      const details = fastifyError.validation.map(({ instancePath, message }) => ({
        field: instancePath ?? "",
        message: message ?? "Invalid value",
      }));
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details,
        },
      });
    }

    reply
      .code(statusCode)
      .send(errorBody(fastifyError.code ?? "CLIENT_ERROR", fastifyError.message));
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
        if (new Date(request.body.expiresAt).getTime() < Date.now()) {
          return reply
            .code(400)
            .send(errorBody("INVALID_EXPIRY", "expiresAt must be in the future"));
        }
        const flag = store.create(request.body);
        return reply.code(201).send(flag);
      } catch (error) {
        if (error instanceof DuplicateFlagError) {
          const code = error.archived ? "FLAG_ARCHIVED" : "FLAG_EXISTS";
          return reply.code(409).send(errorBody(code, error.message));
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
    async (request): Promise<AdminFlag[]> =>
      store.list(request.query.includeArchived ?? false).map(withStale),
  );

  app.get<{ Params: { key: string } }>(
    "/v1/admin/flags/:key",
    { schema: { params: { type: "object", required: ["key"], properties: { key: keySchema } } } },
    async (request, reply) => {
      const flag = store.get(request.params.key);
      if (!flag) {
        return reply.code(404).send(errorBody("NOT_FOUND", "Flag not found"));
      }
      return withStale(flag);
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
      const current = store.get(request.params.key);
      if (!current) {
        return reply.code(404).send(errorBody("NOT_FOUND", "Flag not found"));
      }
      if (current.archivedAt !== null) {
        return reply
          .code(409)
          .send(errorBody("FLAG_ARCHIVED", "Archived flags cannot be updated"));
      }
      if (request.body.expiresAt && new Date(request.body.expiresAt).getTime() < Date.now()) {
        return reply
          .code(400)
          .send(errorBody("INVALID_EXPIRY", "expiresAt must be in the future"));
      }
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
                customerId: { type: "string", minLength: 1 },
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

function withStale(flag: Flag): AdminFlag {
  return { ...flag, stale: new Date(flag.expiresAt).getTime() < Date.now() };
}

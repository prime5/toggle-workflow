import Fastify from "fastify";
import type { FlagSnapshot } from "@toggle-workflow/sdk";

const app = Fastify({ logger: true });

app.get("/healthz", async () => ({ ok: true }));

// Phase 1 replaces this with real evaluation backed by a flag store.
app.get("/v1/flags", async (): Promise<FlagSnapshot> => ({}));

const port = Number(process.env.PORT ?? 4000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

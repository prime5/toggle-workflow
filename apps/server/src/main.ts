import { buildApp } from "./app.js";
import { SQLiteFlagStore } from "./store.js";

const store = new SQLiteFlagStore(process.env.DB_PATH ?? "./data/flags.db");
const app = buildApp({ store, logger: true });

const port = Number(process.env.PORT ?? 4000);
app.listen({ port, host: "0.0.0.0" }).catch((err: Error) => {
  app.log.error(err);
  process.exit(1);
});

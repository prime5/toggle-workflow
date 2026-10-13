interface ClosableApp {
  close(): Promise<unknown>;
}

interface SignalSource {
  once(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export function registerShutdownHandlers(
  app: ClosableApp,
  closeStore: () => void,
  signals: SignalSource = process,
): void {
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    shutdownPromise ??= (async () => {
      try {
        await app.close();
      } finally {
        closeStore();
      }
    })();
    return shutdownPromise;
  };

  signals.once("SIGINT", shutdown);
  signals.once("SIGTERM", shutdown);
}

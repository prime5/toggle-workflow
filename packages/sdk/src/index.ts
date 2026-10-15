// Shared flag types. The server, SDK and admin UI all import these, so a flag
// means the same thing everywhere.
export interface Flag {
  key: string;
  description: string;
  owner: string;
  expiresAt: string;
  enabled: boolean;
  rolloutPercent: number;
  targetCustomers: string[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface EvaluationContext {
  userKey: string;
  customerId?: string;
}

export type FlagSnapshot = Record<string, boolean>;

export { createFlagClient } from "./client.js";
export type { ClientStatus, FlagClient, FlagClientOptions } from "./client.js";
export type { BreakerState } from "./breaker.js";

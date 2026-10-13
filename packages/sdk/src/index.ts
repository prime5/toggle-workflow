// Shared flag types. The server, SDK and admin UI all import these, so a flag
// means the same thing everywhere.
export interface Flag {
  key: string;
  enabled: boolean;
  owner: string;
  // Flags get a removal date at creation — cleanup is part of the flag's lifecycle.
  expiresAt?: string;
}

export type FlagSnapshot = Record<string, boolean>;

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Flag } from "@toggle-workflow/sdk";

export interface CreateFlagInput {
  key: string;
  description: string;
  owner: string;
  expiresAt: string;
  enabled?: boolean;
  rolloutPercent?: number;
  targetCustomers?: string[];
}

export type FlagPatch = Partial<
  Pick<Flag, "description" | "owner" | "expiresAt" | "enabled" | "rolloutPercent" | "targetCustomers">
>;

export interface FlagStore {
  create(input: CreateFlagInput): Flag;
  get(key: string): Flag | undefined;
  list(includeArchived?: boolean): Flag[];
  update(key: string, patch: FlagPatch): Flag | undefined;
  archive(key: string): Flag | undefined;
}

export class DuplicateFlagError extends Error {
  constructor(key: string) {
    super(`Flag '${key}' already exists`);
    this.name = "DuplicateFlagError";
  }
}

type FlagRow = {
  key: string;
  description: string;
  owner: string;
  expires_at: string;
  enabled: number;
  rollout_percent: number;
  target_customers: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export class SQLiteFlagStore implements FlagStore {
  private readonly database: DatabaseSync;

  constructor(path = process.env.DB_PATH ?? "./data/flags.db") {
    if (path !== ":memory:") {
      mkdirSync(dirname(resolve(path)), { recursive: true });
    }

    this.database = new DatabaseSync(path);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS flags (
        key TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        owner TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        rollout_percent INTEGER NOT NULL,
        target_customers TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      ) STRICT
    `);
  }

  create(input: CreateFlagInput): Flag {
    if (this.get(input.key)) {
      throw new DuplicateFlagError(input.key);
    }

    const now = new Date().toISOString();
    const flag: Flag = {
      key: input.key,
      description: input.description,
      owner: input.owner,
      expiresAt: input.expiresAt,
      enabled: input.enabled ?? false,
      rolloutPercent: input.rolloutPercent ?? 0,
      targetCustomers: input.targetCustomers ?? [],
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };

    this.database.prepare(`
      INSERT INTO flags (
        key, description, owner, expires_at, enabled, rollout_percent,
        target_customers, created_at, updated_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      flag.key,
      flag.description,
      flag.owner,
      flag.expiresAt,
      Number(flag.enabled),
      flag.rolloutPercent,
      JSON.stringify(flag.targetCustomers),
      flag.createdAt,
      flag.updatedAt,
    );

    return flag;
  }

  get(key: string): Flag | undefined {
    const row = this.database.prepare("SELECT * FROM flags WHERE key = ?").get(key) as
      | FlagRow
      | undefined;
    return row ? this.toFlag(row) : undefined;
  }

  list(includeArchived = false): Flag[] {
    const query = includeArchived
      ? "SELECT * FROM flags ORDER BY key"
      : "SELECT * FROM flags WHERE archived_at IS NULL ORDER BY key";
    return (this.database.prepare(query).all() as FlagRow[]).map((row) => this.toFlag(row));
  }

  update(key: string, patch: FlagPatch): Flag | undefined {
    const current = this.get(key);
    if (!current) {
      return undefined;
    }

    const updated: Flag = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.database.prepare(`
      UPDATE flags SET
        description = ?, owner = ?, expires_at = ?, enabled = ?, rollout_percent = ?,
        target_customers = ?, updated_at = ?
      WHERE key = ?
    `).run(
      updated.description,
      updated.owner,
      updated.expiresAt,
      Number(updated.enabled),
      updated.rolloutPercent,
      JSON.stringify(updated.targetCustomers),
      updated.updatedAt,
      key,
    );
    return updated;
  }

  archive(key: string): Flag | undefined {
    const current = this.get(key);
    if (!current) {
      return undefined;
    }
    if (current.archivedAt !== null) {
      return current;
    }

    const now = new Date().toISOString();
    this.database.prepare(
      "UPDATE flags SET archived_at = ?, updated_at = ? WHERE key = ?",
    ).run(now, now, key);
    return { ...current, archivedAt: now, updatedAt: now };
  }

  close(): void {
    this.database.close();
  }

  private toFlag(row: FlagRow): Flag {
    return {
      key: row.key,
      description: row.description,
      owner: row.owner,
      expiresAt: row.expires_at,
      enabled: row.enabled === 1,
      rolloutPercent: row.rollout_percent,
      targetCustomers: JSON.parse(row.target_customers) as string[],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
    };
  }
}
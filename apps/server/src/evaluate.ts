import { createHash } from "node:crypto";
import type { EvaluationContext, Flag } from "@toggle-workflow/sdk";

export function evaluate(flag: Flag, ctx: EvaluationContext): boolean {
  if (flag.archivedAt !== null || !flag.enabled) {
    return false;
  }

  if (ctx.customerId !== undefined && flag.targetCustomers.includes(ctx.customerId)) {
    return true;
  }

  const digest = createHash("sha256").update(`${flag.key}:${ctx.userKey}`).digest();
  const bucket = digest.readUInt32BE(0) % 100;
  return bucket < flag.rolloutPercent;
}

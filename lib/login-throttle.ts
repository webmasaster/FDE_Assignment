import { createHmac } from "node:crypto";
import { prisma } from "./prisma";

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

function rateLimitKey(email: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("hex");
}

export async function isLoginThrottled(email: string, now = new Date()) {
  const row = await prisma.loginRateLimit.findUnique({ where: { key: rateLimitKey(email) } });
  if (!row) return false;
  if (row.lockedUntil && row.lockedUntil > now) return true;
  return row.windowStartedAt.getTime() + WINDOW_MS <= now.getTime() ? false : row.failures >= MAX_FAILURES;
}

export async function recordLoginFailure(email: string) {
  const key = rateLimitKey(email);
  await prisma.$executeRaw`
    INSERT INTO "LoginRateLimit" ("key", "failures", "windowStartedAt", "lockedUntil", "updatedAt")
    VALUES (${key}, 1, NOW(), NULL, NOW())
    ON CONFLICT ("key") DO UPDATE SET
      "failures" = CASE
        WHEN "LoginRateLimit"."windowStartedAt" <= NOW() - INTERVAL '15 minutes' THEN 1
        ELSE "LoginRateLimit"."failures" + 1
      END,
      "windowStartedAt" = CASE
        WHEN "LoginRateLimit"."windowStartedAt" <= NOW() - INTERVAL '15 minutes' THEN NOW()
        ELSE "LoginRateLimit"."windowStartedAt"
      END,
      "lockedUntil" = CASE
        WHEN "LoginRateLimit"."lockedUntil" > NOW() THEN "LoginRateLimit"."lockedUntil"
        WHEN "LoginRateLimit"."windowStartedAt" <= NOW() - INTERVAL '15 minutes' THEN NULL
        WHEN "LoginRateLimit"."failures" + 1 >= ${MAX_FAILURES} THEN NOW() + INTERVAL '15 minutes'
        ELSE NULL
      END,
      "updatedAt" = NOW()
  `;
}

export async function clearLoginFailures(email: string) {
  await prisma.loginRateLimit.deleteMany({ where: { key: rateLimitKey(email) } });
}

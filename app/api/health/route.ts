import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "ok" });
  } catch (error: unknown) {
    const eventId = logError("HEALTH_DATABASE_ERROR", error);
    return NextResponse.json({ status: "error", database: "unreachable", eventId }, { status: 503 });
  }
}

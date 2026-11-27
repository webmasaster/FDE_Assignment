import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "ok" });
  } catch (error) {
    console.error(new Date().toISOString(), "HEALTH_DATABASE_ERROR", error);
    return NextResponse.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
}

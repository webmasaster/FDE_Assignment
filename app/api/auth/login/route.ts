import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { loginBodySchema } from "@/lib/validation";
import { logError } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }
    const body = loginBodySchema.safeParse(input);
    if (!body.success) return NextResponse.json({ error: "Enter a valid email and password" }, { status: 400 });
    const { email, password } = body.data;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    await createSession(user);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const eventId = logError("LOGIN_ERROR", error);
    return NextResponse.json({ error: "Unable to sign in", eventId }, { status: 500 });
  }
}

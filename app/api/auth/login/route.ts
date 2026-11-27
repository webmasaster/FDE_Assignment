import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    await createSession(user);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(new Date().toISOString(), "LOGIN_ERROR", error);
    return NextResponse.json({ error: "Unable to sign in" }, { status: 500 });
  }
}

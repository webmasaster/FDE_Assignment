import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { Role, User } from "@prisma/client";

const COOKIE = "pep_po_session";

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new TextEncoder().encode(value);
}

export async function createSession(user: Pick<User, "id" | "email" | "roles">) {
  const token = await new SignJWT({ uid: user.id, email: user.email, roles: user.roles })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret());
  cookies().set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8
  });
}

export async function clearSession() {
  cookies().delete(COOKIE);
}

export async function getSession() {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as { uid: string; email: string; roles: Role[] };
  } catch {
    return null;
  }
}

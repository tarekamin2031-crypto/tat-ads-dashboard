"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/accounts";
import { sessionCookieName, sessionToken, verifyPassword } from "@/lib/auth";

export async function login(slug: string, formData: FormData) {
  const acc = await getAccount(slug);
  const password = String(formData.get("password") ?? "");
  if (!acc || !verifyPassword(password, acc.password_hash)) {
    redirect(`/c/${slug}?error=1`);
  }
  (await cookies()).set(sessionCookieName(slug), sessionToken(slug, acc.password_hash), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: `/c/${slug}`,
  });
  redirect(`/c/${slug}`);
}

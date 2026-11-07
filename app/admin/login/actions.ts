"use server";

import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminToken } from "@/lib/auth";

export async function adminLogin(formData: FormData) {
  const given = Buffer.from(String(formData.get("password") ?? ""));
  const real = Buffer.from(process.env.DASHBOARD_PASSWORD ?? "");
  if (real.length === 0 || given.length !== real.length || !timingSafeEqual(given, real)) {
    redirect("/admin/login?error=1");
  }
  (await cookies()).set("admin_session", adminToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/admin");
}

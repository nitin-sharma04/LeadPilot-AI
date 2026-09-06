"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { registerUser } from "@/services/auth-service";
import { loginSchema, signupSchema } from "@/lib/validations";
import { toErrorMessage } from "@/lib/errors";

export async function loginAction(formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid credentials" };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/dashboard",
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Invalid email or password" };
    }
    // Next.js redirect throws; rethrow so navigation works
    throw error;
  }
}

export async function demoLoginAction() {
  const { isDemoModeEnabled } = await import("@/lib/app-url");
  if (!isDemoModeEnabled()) {
    return { error: "Demo mode is disabled in this environment." };
  }

  const email = process.env.DEMO_EMAIL;
  const password = process.env.DEMO_PASSWORD;

  if (!email || !password) {
    return { error: "Demo access is not configured." };
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/dashboard",
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Demo login failed. Seed the database first." };
    }
    throw error;
  }
}

export async function signupAction(formData: FormData) {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    companyName: formData.get("companyName"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid signup data" };
  }

  try {
    await registerUser(parsed.data);
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/onboarding",
    });
    return { ok: true };
  } catch (error) {
    return { error: toErrorMessage(error, "Unable to create account") };
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}

"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { demoLoginAction, loginAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function LoginForm({ demoEnabled }: { demoEnabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(160deg,#f4f7fb_0%,#e8eef6_50%,#dde6f2_100%)] px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <p className="text-sm font-bold tracking-[0.14em] text-foreground">
            LEADPILOT <span className="text-primary">AI</span>
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            Sign in to your workspace
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Turn every lead into an opportunity.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Welcome back</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              action={(formData) => {
                setError(null);
                startTransition(async () => {
                  try {
                    const result = await loginAction(formData);
                    if (result?.error) setError(result.error);
                  } catch {
                    setError("Something went wrong. Please try again.");
                  }
                });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@company.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={8}
                />
                <p className="text-xs text-muted-foreground">
                  <Link href="/forgot-password" className="hover:underline">
                    Forgot password?
                  </Link>
                </p>
              </div>
              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? "Signing in…" : "Sign in"}
              </Button>
            </form>

            {demoEnabled ? (
              <>
                <div className="my-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">or</span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    startTransition(async () => {
                      const result = await demoLoginAction();
                      if (result?.error) setError(result.error);
                    });
                  }}
                >
                  Try Live Demo
                </Button>
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Opens the seeded demo workspace only — not your production data.
                </p>
              </>
            ) : null}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}

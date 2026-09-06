"use client";

import { FormEvent, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function AcceptInviteInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") || "";
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/team/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "accept",
          token,
          name: fd.get("name"),
          password: fd.get("password"),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Unable to accept invitation");
        return;
      }
      toast.success(`Joined ${json.data.companyName}. Sign in to continue.`);
      router.push("/login");
    });
  }

  if (!token) {
    return <p className="text-sm text-destructive">Missing invitation token.</p>;
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Label htmlFor="name">Full name</Label>
        <Input id="name" name="name" required minLength={2} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Create password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
        />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Join workspace</CardTitle>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<p className="text-sm">Loading…</p>}>
              <AcceptInviteInner />
            </Suspense>
            <p className="mt-4 text-center text-sm text-muted-foreground">
              <Link href="/login" className="hover:underline">
                Already have an account?
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

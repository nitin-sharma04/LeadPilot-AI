"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function InviteMemberButton() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [acceptUrl, setAcceptUrl] = useState<string | null>(null);

  async function invite() {
    setBusy(true);
    setAcceptUrl(null);
    try {
      const res = await fetch("/api/team/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: "SALES_REP" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Invite failed");
      toast.success(json.data.message || "Invitation created");
      if (json.data.acceptUrl) setAcceptUrl(json.data.acceptUrl);
      else setOpen(false);
      setEmail("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to invite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="h-4 w-4" />
          Invite Member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite teammate</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="invite-email">Work email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Creates a secure, expiring invitation. Email delivery requires a
            mailer; until then you&apos;ll get a one-time accept link.
          </p>
          {acceptUrl ? (
            <div className="break-all rounded-md border bg-muted/40 p-2 text-xs">
              {acceptUrl}
            </div>
          ) : null}
          <Button disabled={busy || !email.includes("@")} onClick={() => void invite()}>
            {busy ? "Creating…" : "Create invitation"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

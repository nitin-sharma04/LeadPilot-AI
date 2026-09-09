"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import Link from "next/link";
import type { AddLeadResult } from "@/lib/lead-create-client";
import type { Lead, LeadSource } from "@/types";

interface AddLeadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (lead: Lead) => Promise<AddLeadResult>;
}

export function AddLeadModal({ open, onOpenChange, onAdd }: AddLeadModalProps) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState<LeadSource>("Website");
  const [dealValue, setDealValue] = useState("5000");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [existingLeadId, setExistingLeadId] = useState<string | null>(null);

  function reset() {
    setName("");
    setCompany("");
    setEmail("");
    setPhone("");
    setSource("Website");
    setDealValue("5000");
    setMessage("");
    setFormError(null);
    setExistingLeadId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!name.trim() || !company.trim() || !email.trim()) return;

    setSaving(true);
    setFormError(null);
    setExistingLeadId(null);
    try {
      const value = Math.trunc(Math.max(0, Number(dealValue) || 0));
      const lead: Lead = {
        id: "temp",
        name: name.trim(),
        company: company.trim(),
        email: email.trim(),
        phone: phone.trim(),
        industry: "General",
        source,
        score: 50,
        dealValue: value,
        status: "new",
        ownerId: "",
        createdAt: new Date().toISOString(),
        message:
          message.trim() ||
          "New lead captured in LeadPilot.",
        intent: "Medium",
        urgency: "Medium",
        estimatedBudget: "To be determined",
        recommendedAction: "Qualify this lead and schedule a first touch.",
      };
      const result = await onAdd(lead);
      if (!result.ok) {
        setFormError(result.error);
        setExistingLeadId(result.existingLeadId ?? null);
        return;
      }
      reset();
      onOpenChange(false);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Unable to create lead"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving && !next) return;
        if (!next) {
          setFormError(null);
          setExistingLeadId(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Lead</DialogTitle>
          <DialogDescription>
            Creates a lead in your company workspace and stores it in PostgreSQL.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="lead-name">Name</Label>
              <Input
                id="lead-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={2}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-company">Company</Label>
              <Input
                id="lead-company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-email">Email</Label>
              <Input
                id="lead-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-phone">Phone</Label>
              <Input
                id="lead-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-source">Source</Label>
              <select
                id="lead-source"
                className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
                value={source}
                onChange={(e) => setSource(e.target.value as LeadSource)}
              >
                <option>Website</option>
                <option>Google Ads</option>
                <option>LinkedIn</option>
                <option>Facebook</option>
                <option>Referral</option>
                <option>Cold Outreach</option>
                <option>Partner</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-value">Deal value (USD)</Label>
              <Input
                id="lead-value"
                type="number"
                min={0}
                step={1}
                value={dealValue}
                onChange={(e) => setDealValue(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="lead-message">Message</Label>
            <textarea
              id="lead-message"
              className="min-h-[88px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What is the lead looking for?"
            />
          </div>
          {formError ? (
            <p className="text-sm text-destructive" role="alert">
              {formError}
              {existingLeadId ? (
                <>
                  {" "}
                  <Link
                    href={`/dashboard/leads/${existingLeadId}`}
                    className="font-medium underline underline-offset-2"
                  >
                    Open existing lead
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Add lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

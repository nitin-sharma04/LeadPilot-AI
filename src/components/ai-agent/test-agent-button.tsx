"use client";

import { useState } from "react";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function TestAgentButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Mic className="h-4 w-4" />
        Test Agent
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test Agent</DialogTitle>
            <DialogDescription>
              Voice Agent integration will be connected in the next phase.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            In a later phase, this will place a real test call using your configured
            voice, greeting, and qualification questions.
          </p>
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

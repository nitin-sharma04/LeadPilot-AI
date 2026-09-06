"use client";

import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CreateSequenceButton() {
  return (
    <Button
      onClick={() =>
        toast("Sequence builder automation will connect in a later phase.")
      }
    >
      <Plus className="h-4 w-4" />
      Create Sequence
    </Button>
  );
}

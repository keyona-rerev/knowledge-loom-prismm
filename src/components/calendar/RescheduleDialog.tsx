import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { describeInvokeError } from "@/lib/edgeFunctionError";
import { toast } from "sonner";
import { ScheduledDraft } from "./schedule-types";

interface RescheduleDialogProps {
  draft: ScheduledDraft | null;
  onClose: () => void;
  onRescheduled: () => void;
}

function toLocalDatetimeInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const RescheduleDialog = ({ draft, onClose, onRescheduled }: RescheduleDialogProps) => {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (draft) setValue(toLocalDatetimeInputValue(draft.scheduled_for));
  }, [draft]);

  const handleSave = async () => {
    if (!draft || !value) return;
    const newDate = new Date(value);
    if (Number.isNaN(newDate.getTime())) { toast.error("Pick a valid date and time"); return; }
    if (newDate.getTime() <= Date.now()) { toast.error("Pick a time in the future"); return; }

    setSaving(true);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const { data, error } = await supabase.functions.invoke("reschedule-draft", {
        body: { draftId: draft.id, newScheduledFor: newDate.toISOString(), timezone },
      });
      if (error) {
        toast.error("Reschedule failed: " + (await describeInvokeError(error)));
      } else if (data?.ok) {
        toast.success("Rescheduled");
      } else {
        toast.error(data?.error || "Reschedule failed");
      }
      // Refresh either way: even a failed reschedule can change the draft's
      // state server-side (e.g. the old post was cancelled but republishing
      // failed), so the calendar shouldn't keep showing a stale card at the
      // old time.
      onRescheduled();
    } catch (err) {
      toast.error("Reschedule failed: " + (err as Error)?.message);
      onRescheduled();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!draft} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Edit scheduled time</DialogTitle>
          <DialogDescription>{draft?.title || "Untitled draft"}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="reschedule-time">New date and time</Label>
          <input
            id="reschedule-time"
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

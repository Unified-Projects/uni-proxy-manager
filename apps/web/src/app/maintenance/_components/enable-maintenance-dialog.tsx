"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
  useToast,
} from "@uni-proxy-manager/ui";
import { useEnableMaintenance } from "@/hooks/use-maintenance";
import type { Domain } from "@/lib/types";
import { Plus, X } from "lucide-react";

const formSchema = z.object({
  reason: z.string().optional(),
  bypassIps: z.array(z.string().ip({ message: "Invalid IP address" })).optional(),
});

type FormData = z.infer<typeof formSchema>;

interface EnableMaintenanceDialogProps {
  domain: Domain | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EnableMaintenanceDialog({
  domain,
  open,
  onOpenChange,
}: EnableMaintenanceDialogProps) {
  const { toast } = useToast();
  const [newIp, setNewIp] = useState("");
  const enableMaintenance = useEnableMaintenance();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      reason: "",
      bypassIps: [],
    },
  });

  const bypassIps = form.watch("bypassIps") ?? [];

  const handleAddIp = () => {
    const trimmedIp = newIp.trim();
    if (!trimmedIp) return;

    // Basic IP validation
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (!ipRegex.test(trimmedIp)) {
      toast({
        title: "Invalid IP",
        description: "Please enter a valid IPv4 address.",
        variant: "destructive",
      });
      return;
    }

    if (bypassIps.includes(trimmedIp)) {
      toast({
        title: "Duplicate IP",
        description: "This IP is already in the list.",
        variant: "destructive",
      });
      return;
    }

    form.setValue("bypassIps", [...bypassIps, trimmedIp]);
    setNewIp("");
  };

  const handleRemoveIp = (ip: string) => {
    form.setValue("bypassIps", bypassIps.filter((i) => i !== ip));
  };

  const onSubmit = async (data: FormData) => {
    if (!domain) return;

    try {
      await enableMaintenance.mutateAsync({
        domainId: domain.id,
        data: {
          reason: data.reason || undefined,
          bypassIps: data.bypassIps?.length ? data.bypassIps : undefined,
        },
      });

      toast({
        title: "Maintenance enabled",
        description: `${domain.hostname} is now in maintenance mode.`,
      });

      form.reset();
      setNewIp("");
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to enable maintenance",
        variant: "destructive",
      });
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      form.reset();
      setNewIp("");
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Enable Maintenance Mode</DialogTitle>
          <DialogDescription>
            Enable maintenance mode for <strong>{domain?.hostname}</strong>. Users will see
            the maintenance page instead of the site.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Scheduled maintenance for database upgrade..."
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Internal note about why maintenance is enabled.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <FormLabel>Bypass IPs (optional)</FormLabel>
              <FormDescription>
                These IP addresses will bypass maintenance mode and see the live site.
              </FormDescription>

              <div className="flex gap-2">
                <Input
                  placeholder="192.168.1.100"
                  value={newIp}
                  onChange={(e) => setNewIp(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddIp();
                    }
                  }}
                />
                <Button type="button" variant="outline" size="icon" onClick={handleAddIp}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {bypassIps.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {bypassIps.map((ip) => (
                    <div
                      key={ip}
                      className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-sm"
                    >
                      <code>{ip}</code>
                      <button
                        type="button"
                        onClick={() => handleRemoveIp(ip)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={enableMaintenance.isPending}>
                {enableMaintenance.isPending ? "Enabling..." : "Enable Maintenance"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

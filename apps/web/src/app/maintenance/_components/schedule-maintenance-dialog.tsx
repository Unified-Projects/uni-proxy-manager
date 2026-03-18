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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  useToast,
} from "@uni-proxy-manager/ui";
import { useDomains } from "@/hooks/use-domains";
import { useScheduleMaintenance } from "@/hooks/use-maintenance";
import { Plus, X } from "lucide-react";

const formSchema = z.object({
  domainId: z.string().min(1, "Domain is required"),
  title: z.string().optional(),
  reason: z.string().optional(),
  scheduledStartAt: z.string().min(1, "Start time is required"),
  scheduledEndAt: z.string().optional(),
  bypassIps: z.array(z.string()).optional(),
  notifyOnStart: z.boolean().optional(),
  notifyOnEnd: z.boolean().optional(),
  notificationWebhook: z.string().url().optional().or(z.literal("")),
});

type FormData = z.infer<typeof formSchema>;

interface ScheduleMaintenanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ScheduleMaintenanceDialog({
  open,
  onOpenChange,
}: ScheduleMaintenanceDialogProps) {
  const { toast } = useToast();
  const [newIp, setNewIp] = useState("");
  const { data: domains } = useDomains();
  const scheduleMaintenance = useScheduleMaintenance();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      domainId: "",
      title: "",
      reason: "",
      scheduledStartAt: "",
      scheduledEndAt: "",
      bypassIps: [],
      notifyOnStart: false,
      notifyOnEnd: false,
      notificationWebhook: "",
    },
  });

  const bypassIps = form.watch("bypassIps") ?? [];
  const notifyOnStart = form.watch("notifyOnStart");
  const notifyOnEnd = form.watch("notifyOnEnd");
  const showWebhook = notifyOnStart || notifyOnEnd;

  const handleAddIp = () => {
    const trimmedIp = newIp.trim();
    if (!trimmedIp) return;

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
    try {
      await scheduleMaintenance.mutateAsync({
        domainId: data.domainId,
        title: data.title || undefined,
        reason: data.reason || undefined,
        scheduledStartAt: new Date(data.scheduledStartAt).toISOString(),
        scheduledEndAt: data.scheduledEndAt
          ? new Date(data.scheduledEndAt).toISOString()
          : undefined,
        bypassIps: data.bypassIps?.length ? data.bypassIps : undefined,
        notifyOnStart: data.notifyOnStart,
        notifyOnEnd: data.notifyOnEnd,
        notificationWebhook: data.notificationWebhook || undefined,
      });

      toast({
        title: "Maintenance scheduled",
        description: "The maintenance window has been scheduled.",
      });

      form.reset();
      setNewIp("");
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to schedule maintenance",
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

  // Get minimum datetime (now + 5 minutes)
  const getMinDateTime = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    return now.toISOString().slice(0, 16);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule Maintenance</DialogTitle>
          <DialogDescription>
            Schedule a maintenance window for a domain. The maintenance mode will be
            automatically enabled at the scheduled time.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="domainId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Domain</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a domain" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {domains?.map((domain) => (
                        <SelectItem key={domain.id} value={domain.id}>
                          {domain.hostname}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Database Migration" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Upgrading the database to improve performance..."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="scheduledStartAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Time</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" min={getMinDateTime()} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="scheduledEndAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Time (optional)</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" min={getMinDateTime()} {...field} />
                    </FormControl>
                    <FormDescription>Leave empty for manual end.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-2">
              <FormLabel>Bypass IPs (optional)</FormLabel>
              <FormDescription>
                These IP addresses will bypass maintenance mode.
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

            <div className="space-y-4 border-t pt-4">
              <FormLabel className="text-base">Notifications</FormLabel>

              <div className="flex flex-col gap-4">
                <FormField
                  control={form.control}
                  name="notifyOnStart"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Notify on Start</FormLabel>
                        <FormDescription>
                          Send a webhook when maintenance begins.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="notifyOnEnd"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Notify on End</FormLabel>
                        <FormDescription>
                          Send a webhook when maintenance ends.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {showWebhook && (
                  <FormField
                    control={form.control}
                    name="notificationWebhook"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Webhook URL</FormLabel>
                        <FormControl>
                          <Input
                            type="url"
                            placeholder="https://hooks.slack.com/..."
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          URL to receive POST notifications.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={scheduleMaintenance.isPending}>
                {scheduleMaintenance.isPending ? "Scheduling..." : "Schedule Maintenance"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

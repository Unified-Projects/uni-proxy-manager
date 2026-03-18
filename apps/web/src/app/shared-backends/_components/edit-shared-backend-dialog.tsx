"use client";

import { useEffect } from "react";
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
  useToast,
} from "@uni-proxy-manager/ui";
import { useUpdateSharedBackend } from "@/hooks/use-shared-backends";
import type { SharedBackend } from "@/lib/types";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  address: z.string().min(1, "Address is required"),
  port: z.coerce.number().int().min(1).max(65535),
  protocol: z.enum(["http", "https"]),
  weight: z.coerce.number().int().min(1).max(256),
  loadBalanceMethod: z.enum(["roundrobin", "leastconn", "source", "first"]),
  healthCheckEnabled: z.boolean(),
  healthCheckPath: z.string(),
  isBackup: z.boolean(),
  hostRewrite: z.string().optional(),
  pathPrefixAdd: z.string().optional(),
  pathPrefixStrip: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface EditSharedBackendDialogProps {
  backend: SharedBackend;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditSharedBackendDialog({
  backend,
  open,
  onOpenChange,
}: EditSharedBackendDialogProps) {
  const { toast } = useToast();
  const updateSharedBackend = useUpdateSharedBackend();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: backend.name,
      description: backend.description ?? "",
      address: backend.address,
      port: backend.port,
      protocol: backend.protocol,
      weight: backend.weight,
      loadBalanceMethod: backend.loadBalanceMethod,
      healthCheckEnabled: backend.healthCheckEnabled,
      healthCheckPath: backend.healthCheckPath,
      isBackup: backend.isBackup,
      hostRewrite: backend.hostRewrite ?? "",
      pathPrefixAdd: backend.pathPrefixAdd ?? "",
      pathPrefixStrip: backend.pathPrefixStrip ?? "",
    },
  });

  useEffect(() => {
    form.reset({
      name: backend.name,
      description: backend.description ?? "",
      address: backend.address,
      port: backend.port,
      protocol: backend.protocol,
      weight: backend.weight,
      loadBalanceMethod: backend.loadBalanceMethod,
      healthCheckEnabled: backend.healthCheckEnabled,
      healthCheckPath: backend.healthCheckPath,
      isBackup: backend.isBackup,
      hostRewrite: backend.hostRewrite ?? "",
      pathPrefixAdd: backend.pathPrefixAdd ?? "",
      pathPrefixStrip: backend.pathPrefixStrip ?? "",
    });
  }, [backend, form]);

  const onSubmit = async (data: FormData) => {
    try {
      await updateSharedBackend.mutateAsync({ id: backend.id, data });
      toast({ title: "Shared backend updated" });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Shared Backend</DialogTitle>
          <DialogDescription>
            Changes will propagate to all linked domains after saving.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional description" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="port"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Port</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="protocol"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Protocol</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="http">HTTP</SelectItem>
                        <SelectItem value="https">HTTPS</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="weight"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Weight</FormLabel>
                    <FormControl>
                      <Input type="number" min="1" max="256" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="loadBalanceMethod"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Load Balance Method</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="roundrobin">Round Robin</SelectItem>
                      <SelectItem value="leastconn">Least Connections</SelectItem>
                      <SelectItem value="source">Source IP</SelectItem>
                      <SelectItem value="first">First</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="healthCheckEnabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Health Check</FormLabel>
                    <FormDescription>Enable periodic health monitoring</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            {form.watch("healthCheckEnabled") && (
              <FormField
                control={form.control}
                name="healthCheckPath"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Health Check Path</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="isBackup"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Backup Server</FormLabel>
                    <FormDescription>Only used when primary servers are down</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="hostRewrite"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Host Rewrite</FormLabel>
                  <FormControl>
                    <Input placeholder="api.internal.example.com (optional)" {...field} />
                  </FormControl>
                  <FormDescription>Override the Host header sent to backend</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateSharedBackend.isPending}>
                {updateSharedBackend.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

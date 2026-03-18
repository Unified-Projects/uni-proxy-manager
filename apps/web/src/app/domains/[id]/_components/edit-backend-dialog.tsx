"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Button,
  Checkbox,
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
import { useUpdateBackend } from "@/hooks/use-backends";
import { useSites } from "@/hooks/use-sites";
import type { Backend } from "@/lib/types";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  backendType: z.enum(["static", "site"]),
  // Static backend fields
  address: z.string().optional(),
  port: z.coerce.number().min(1).max(65535).optional(),
  protocol: z.enum(["http", "https"]),
  // Site backend fields
  siteId: z.string().optional(),
  // Common fields
  weight: z.coerce.number().min(1).max(256),
  loadBalanceMethod: z.enum(["roundrobin", "leastconn", "source", "first"]),
  healthCheckEnabled: z.boolean(),
  healthCheckPath: z.string().optional(),
  enabled: z.boolean(),
  isBackup: z.boolean().default(false),
  // Request modification options
  hostRewrite: z.string().optional(),
  pathPrefixAdd: z.string().optional(),
  pathPrefixStrip: z.string().optional(),
}).refine((data) => {
  if (data.backendType === "static") {
    return !!data.address;
  } else if (data.backendType === "site") {
    return !!data.siteId;
  }
  return true;
}, {
  message: "Static backends require address, site backends require a site selection",
  path: ["address"],
});

type FormData = z.infer<typeof formSchema>;

interface EditBackendDialogProps {
  backend: Backend | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditBackendDialog({
  backend,
  open,
  onOpenChange,
}: EditBackendDialogProps) {
  const { toast } = useToast();
  const updateBackend = useUpdateBackend();
  const { data: sites = [] } = useSites();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      backendType: "static",
      address: "",
      port: 80,
      protocol: "http",
      siteId: "",
      weight: 100,
      loadBalanceMethod: "roundrobin",
      healthCheckEnabled: true,
      healthCheckPath: "/",
      enabled: true,
      isBackup: false,
      hostRewrite: "",
      pathPrefixAdd: "",
      pathPrefixStrip: "",
    },
  });

  const backendType = form.watch("backendType");

  useEffect(() => {
    if (backend) {
      form.reset({
        name: backend.name,
        backendType: backend.backendType,
        address: backend.address || "",
        port: backend.port || 80,
        protocol: backend.protocol,
        siteId: backend.siteId || "",
        weight: backend.weight,
        loadBalanceMethod: backend.loadBalanceMethod,
        healthCheckEnabled: backend.healthCheckEnabled,
        healthCheckPath: backend.healthCheckPath,
        enabled: backend.enabled,
        isBackup: backend.isBackup,
        hostRewrite: backend.hostRewrite || "",
        pathPrefixAdd: backend.pathPrefixAdd || "",
        pathPrefixStrip: backend.pathPrefixStrip || "",
      });
    }
  }, [backend, form]);

  const onSubmit = async (data: FormData) => {
    if (!backend) return;

    try {
      await updateBackend.mutateAsync({
        id: backend.id,
        data: {
          name: data.name,
          backendType: data.backendType,
          address: data.backendType === "static" ? data.address : null,
          port: data.backendType === "static" ? data.port : null,
          protocol: data.protocol,
          siteId: data.backendType === "site" ? data.siteId : null,
          weight: data.weight,
          loadBalanceMethod: data.loadBalanceMethod,
          healthCheckEnabled: data.healthCheckEnabled,
          healthCheckPath: data.healthCheckPath,
          enabled: data.enabled,
          isBackup: data.isBackup,
          hostRewrite: data.hostRewrite || null,
          pathPrefixAdd: data.pathPrefixAdd || null,
          pathPrefixStrip: data.pathPrefixStrip || null,
        },
      });

      toast({
        title: "Backend updated",
        description: `${data.name} has been updated successfully.`,
      });

      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to update backend",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Backend</DialogTitle>
          <DialogDescription>
            Update the backend server configuration.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 overflow-y-auto flex-1 pr-2">
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
              name="backendType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Backend Type</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="static">Static (IP/Hostname)</SelectItem>
                      <SelectItem value="site">Site (OpenRuntimes)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Static backends use IP/hostname, Site backends route to deployed sites
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {backendType === "static" && (
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
            )}

            {backendType === "site" && (
              <FormField
                control={form.control}
                name="siteId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Site</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a site..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {sites.filter(s => s.status === "active").map((site) => (
                          <SelectItem key={site.id} value={site.id}>
                            {site.name} ({site.framework})
                          </SelectItem>
                        ))}
                        {sites.filter(s => s.status === "active").length === 0 && (
                          <SelectItem value="" disabled>
                            No active sites available
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Select a deployed site to route traffic to
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="grid grid-cols-2 gap-4">
              {backendType === "static" && (
                <FormField
                  control={form.control}
                  name="protocol"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Protocol</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
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
              )}

              <FormField
                control={form.control}
                name="loadBalanceMethod"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Load Balance</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="roundrobin">Round Robin</SelectItem>
                        <SelectItem value="leastconn">Least Connections</SelectItem>
                        <SelectItem value="source">Source IP</SelectItem>
                        <SelectItem value="first">First Available</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="weight"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Weight</FormLabel>
                  <FormControl>
                    <Input type="number" min={1} max={256} {...field} />
                  </FormControl>
                  <FormDescription>
                    Higher weight means more traffic (1-256)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isBackup"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Backup Server</FormLabel>
                    <FormDescription>
                      Only receives traffic when all primary servers are down
                    </FormDescription>
                  </div>
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
                    <FormDescription>
                      Enable health checking for this backend
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
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
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Enabled</FormLabel>
                    <FormDescription>
                      Route traffic to this backend
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {/* Request Modification Options */}
            <div className="space-y-3 rounded-lg border p-4">
              <h4 className="text-sm font-medium">Request Modifications</h4>

              <FormField
                control={form.control}
                name="hostRewrite"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Host Header Override</FormLabel>
                    <FormControl>
                      <Input placeholder="api.internal.example.com" {...field} />
                    </FormControl>
                    <FormDescription>
                      Override the Host header sent to this backend
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="pathPrefixStrip"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Strip Path Prefix</FormLabel>
                      <FormControl>
                        <Input placeholder="/api/v1" {...field} />
                      </FormControl>
                      <FormDescription>
                        Remove this prefix from requests
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="pathPrefixAdd"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Add Path Prefix</FormLabel>
                      <FormControl>
                        <Input placeholder="/internal" {...field} />
                      </FormControl>
                      <FormDescription>
                        Add this prefix to requests
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateBackend.isPending}>
                {updateBackend.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

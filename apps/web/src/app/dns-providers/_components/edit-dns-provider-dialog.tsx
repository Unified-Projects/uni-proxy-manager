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
  useToast,
} from "@uni-proxy-manager/ui";
import { useUpdateDnsProvider } from "@/hooks/use-dns-providers";
import type { DnsProvider } from "@/lib/types";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  // Cloudflare fields
  cfApiToken: z.string().optional(),
  cfEmail: z.string().email().optional().or(z.literal("")),
  cfApiKey: z.string().optional(),
  // Namecheap fields
  ncApiUser: z.string().optional(),
  ncApiKey: z.string().optional(),
  ncClientIp: z.string().optional(),
  ncUsername: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface EditDnsProviderDialogProps {
  provider: DnsProvider | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditDnsProviderDialog({
  provider,
  open,
  onOpenChange,
}: EditDnsProviderDialogProps) {
  const { toast } = useToast();
  const updateProvider = useUpdateDnsProvider();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
    },
  });

  useEffect(() => {
    if (provider) {
      form.reset({
        name: provider.name,
      });
    }
  }, [provider, form]);

  const onSubmit = async (data: FormData) => {
    if (!provider) return;

    try {
      let credentials: Record<string, string> | undefined;

      // Build credentials only if any field is provided
      if (provider.type === "cloudflare") {
        const hasAnyCloudflareField = data.cfApiToken || data.cfEmail || data.cfApiKey;

        if (hasAnyCloudflareField) {
          if (data.cfApiToken) {
            credentials = { apiToken: data.cfApiToken };
          } else if (data.cfEmail && data.cfApiKey) {
            credentials = { email: data.cfEmail, apiKey: data.cfApiKey };
          } else if (data.cfApiToken === "" && data.cfEmail === "" && data.cfApiKey === "") {
            // All fields empty, don't update credentials
            credentials = undefined;
          } else {
            toast({
              title: "Error",
              description: "Please provide either API Token or both Email and API Key",
              variant: "destructive",
            });
            return;
          }
        }
      } else if (provider.type === "namecheap") {
        const hasAnyNamecheapField = data.ncApiUser || data.ncApiKey || data.ncClientIp || data.ncUsername;

        if (hasAnyNamecheapField) {
          // If any field is filled, all required fields must be filled
          if (data.ncApiUser && data.ncApiKey && data.ncClientIp) {
            credentials = {
              apiUser: data.ncApiUser,
              apiKey: data.ncApiKey,
              clientIp: data.ncClientIp,
              ...(data.ncUsername && { username: data.ncUsername }),
            };
          } else if (data.ncApiUser === "" && data.ncApiKey === "" && data.ncClientIp === "" && data.ncUsername === "") {
            // All fields empty, don't update credentials
            credentials = undefined;
          } else {
            toast({
              title: "Error",
              description: "Please provide all required Namecheap credentials: API User, API Key, and Client IP",
              variant: "destructive",
            });
            return;
          }
        }
      }

      await updateProvider.mutateAsync({
        id: provider.id,
        data: {
          name: data.name,
          ...(credentials && { credentials }),
        },
      });

      toast({
        title: "Provider updated",
        description: `${data.name} has been updated successfully.`,
      });

      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to update provider",
        variant: "destructive",
      });
    }
  };

  if (!provider) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit DNS Provider</DialogTitle>
          <DialogDescription>
            Update the {provider.type} provider configuration.
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

            {provider.type === "cloudflare" && (
              <>
                <div className="rounded-lg border p-3 bg-muted/50">
                  <p className="text-sm text-muted-foreground">
                    Leave credential fields empty to keep existing values.
                  </p>
                </div>
                <FormField
                  control={form.control}
                  name="cfApiToken"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API Token</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Your API token" {...field} />
                      </FormControl>
                      <FormDescription>
                        Recommended authentication method
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <p className="text-center text-sm text-muted-foreground">or</p>
                <FormField
                  control={form.control}
                  name="cfEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="email@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="cfApiKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Global API Key</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Your global API key" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {provider.type === "namecheap" && (
              <>
                <div className="rounded-lg border p-3 bg-muted/50">
                  <p className="text-sm text-muted-foreground">
                    Leave credential fields empty to keep existing values.
                  </p>
                </div>
                <FormField
                  control={form.control}
                  name="ncApiUser"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API User</FormLabel>
                      <FormControl>
                        <Input placeholder="Your API username" {...field} />
                      </FormControl>
                      <FormDescription>
                        Required: Your Namecheap API username
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="ncApiKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API Key</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Your API key" {...field} />
                      </FormControl>
                      <FormDescription>
                        Required: Your Namecheap API key
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="ncClientIp"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client IP</FormLabel>
                      <FormControl>
                        <Input placeholder="Your whitelisted IP" {...field} />
                      </FormControl>
                      <FormDescription>
                        Required: IP address whitelisted in Namecheap
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="ncUsername"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Your Namecheap username" {...field} />
                      </FormControl>
                      <FormDescription>
                        Optional: Your Namecheap account username
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateProvider.isPending}>
                {updateProvider.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

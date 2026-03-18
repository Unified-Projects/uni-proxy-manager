"use client";

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
import { useCreateDnsProvider } from "@/hooks/use-dns-providers";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["cloudflare", "namecheap"]),
  isDefault: z.boolean(),
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

interface CreateDnsProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateDnsProviderDialog({
  open,
  onOpenChange,
}: CreateDnsProviderDialogProps) {
  const { toast } = useToast();
  const createProvider = useCreateDnsProvider();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      type: "cloudflare",
      isDefault: false,
      cfApiToken: "",
      cfEmail: "",
      cfApiKey: "",
      ncApiUser: "",
      ncApiKey: "",
      ncClientIp: "",
      ncUsername: "",
    },
  });

  const providerType = form.watch("type");

  const onSubmit = async (data: FormData) => {
    try {
      let credentials: Record<string, string> = {};

      if (data.type === "cloudflare") {
        if (data.cfApiToken) {
          credentials = { apiToken: data.cfApiToken };
        } else if (data.cfEmail && data.cfApiKey) {
          credentials = { email: data.cfEmail, apiKey: data.cfApiKey };
        } else {
          toast({
            title: "Error",
            description: "Please provide either API Token or Email + API Key",
            variant: "destructive",
          });
          return;
        }
      } else {
        if (!data.ncApiUser || !data.ncApiKey || !data.ncClientIp) {
          toast({
            title: "Error",
            description: "Please provide all required Namecheap credentials",
            variant: "destructive",
          });
          return;
        }
        credentials = {
          apiUser: data.ncApiUser,
          apiKey: data.ncApiKey,
          clientIp: data.ncClientIp,
          ...(data.ncUsername && { username: data.ncUsername }),
        };
      }

      await createProvider.mutateAsync({
        name: data.name,
        type: data.type,
        credentials,
        isDefault: data.isDefault,
      });

      toast({
        title: "Provider created",
        description: `${data.name} has been added successfully.`,
      });

      form.reset();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to create provider",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add DNS Provider</DialogTitle>
          <DialogDescription>
            Add a DNS provider for certificate validation.
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
                    <Input placeholder="My DNS Provider" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Provider Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="cloudflare">Cloudflare</SelectItem>
                      <SelectItem value="namecheap">Namecheap</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {providerType === "cloudflare" && (
              <>
                <FormField
                  control={form.control}
                  name="cfApiToken"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API Token (recommended)</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Your API token" {...field} />
                      </FormControl>
                      <FormDescription>
                        Create a token with DNS edit permissions
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

            {providerType === "namecheap" && (
              <>
                <FormField
                  control={form.control}
                  name="ncApiUser"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API User</FormLabel>
                      <FormControl>
                        <Input placeholder="Your API username" {...field} />
                      </FormControl>
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
                        IP address whitelisted for API access
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
                      <FormLabel>Username (optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="If different from API User" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            <FormField
              control={form.control}
              name="isDefault"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Set as Default</FormLabel>
                    <FormDescription>
                      Use this provider for new certificates
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

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createProvider.isPending}>
                {createProvider.isPending ? "Creating..." : "Create Provider"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

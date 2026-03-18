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
import { useCreateDomain } from "@/hooks/use-domains";
import { useDnsProviders } from "@/hooks/use-dns-providers";

const formSchema = z.object({
  hostname: z
    .string()
    .min(1, "Hostname is required")
    .regex(
      /^(\*\.)?(?!:\/\/)([a-zA-Z0-9-_]+\.)*[a-zA-Z0-9][a-zA-Z0-9-_]+\.[a-zA-Z]{2,11}?$/,
      "Invalid hostname format (use *.domain.com for wildcards)"
    ),
  displayName: z.string().optional(),
  sslEnabled: z.boolean().default(true),
  forceHttps: z.boolean().default(true),
  acmeVerificationMethod: z.enum(["dns-01", "http-01", "none"]).default("dns-01"),
  acmeDnsProviderId: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface CreateDomainDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateDomainDialog({
  open,
  onOpenChange,
}: CreateDomainDialogProps) {
  const { toast } = useToast();
  const createDomain = useCreateDomain();
  const { data: dnsProviders } = useDnsProviders();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      hostname: "",
      displayName: "",
      sslEnabled: true,
      forceHttps: true,
      acmeVerificationMethod: "dns-01",
    },
  });

  const sslEnabled = form.watch("sslEnabled");
  const acmeVerificationMethod = form.watch("acmeVerificationMethod");

  const onSubmit = async (data: FormData) => {
    try {
      // Validate DNS provider is selected if DNS-01 verification is chosen
      if (data.sslEnabled && data.acmeVerificationMethod === "dns-01" && !data.acmeDnsProviderId) {
        toast({
          title: "Error",
          description: "Please select a DNS provider for DNS-01 verification",
          variant: "destructive",
        });
        return;
      }

      await createDomain.mutateAsync({
        hostname: data.hostname,
        displayName: data.displayName || undefined,
        sslEnabled: data.sslEnabled,
        forceHttps: data.forceHttps,
        acmeVerificationMethod: data.acmeVerificationMethod,
        acmeDnsProviderId: data.acmeDnsProviderId,
      });

      toast({
        title: "Domain created",
        description: `${data.hostname} has been added successfully.`,
      });

      form.reset();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to create domain",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Domain</DialogTitle>
          <DialogDescription>
            Add a new domain to manage. You can configure backends and SSL after creation.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="hostname"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Hostname</FormLabel>
                  <FormControl>
                    <Input placeholder="example.com" {...field} />
                  </FormControl>
                  <FormDescription>
                    The domain name without protocol (e.g., example.com)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Name (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="My Website" {...field} />
                  </FormControl>
                  <FormDescription>
                    A friendly name for this domain
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sslEnabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Enable SSL</FormLabel>
                    <FormDescription>
                      Request an SSL certificate for this domain
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

            <FormField
              control={form.control}
              name="forceHttps"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Force HTTPS</FormLabel>
                    <FormDescription>
                      Redirect all HTTP traffic to HTTPS
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

            {sslEnabled && (
              <>
                <FormField
                  control={form.control}
                  name="acmeVerificationMethod"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ACME Verification Method</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select verification method" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="dns-01">
                            DNS-01 Challenge (Recommended)
                          </SelectItem>
                          <SelectItem value="http-01">
                            HTTP-01 Challenge
                          </SelectItem>
                          <SelectItem value="none">
                            None (Manual Certificate)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {acmeVerificationMethod === "dns-01" &&
                          "Automatically creates DNS TXT records via your DNS provider API. Works with wildcard certificates."}
                        {acmeVerificationMethod === "http-01" &&
                          "Uses HTTP validation on your domain. Domain must be publicly accessible."}
                        {acmeVerificationMethod === "none" &&
                          "Skip automatic certificate issuance. You can upload a certificate manually later."}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {acmeVerificationMethod === "dns-01" && (
                  <FormField
                    control={form.control}
                    name="acmeDnsProviderId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>DNS Provider</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select DNS provider" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {dnsProviders && dnsProviders.length > 0 ? (
                              dnsProviders.map((provider) => (
                                <SelectItem key={provider.id} value={provider.id}>
                                  {provider.name} ({provider.type})
                                  {provider.isDefault && " (Default)"}
                                </SelectItem>
                              ))
                            ) : (
                              <SelectItem value="none" disabled>
                                No DNS providers configured
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          The DNS provider used to create TXT records for domain verification.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
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
              <Button type="submit" disabled={createDomain.isPending}>
                {createDomain.isPending ? "Creating..." : "Create Domain"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect, useState } from "react";
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
import { X } from "lucide-react";
import { useUpdateDomain } from "@/hooks/use-domains";
import { useDnsProviders } from "@/hooks/use-dns-providers";
import type { Domain } from "@/lib/types";

const formSchema = z.object({
  displayName: z.string().optional(),
  sslEnabled: z.boolean(),
  forceHttps: z.boolean(),
  acmeVerificationMethod: z.enum(["dns-01", "http-01", "none"]).optional(),
  acmeDnsProviderId: z.string().nullable().optional(),
  wwwRedirectEnabled: z.boolean(),
  subdomainAliases: z.array(z.string()),
});

type FormData = z.infer<typeof formSchema>;

interface EditDomainDialogProps {
  domain: Domain;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditDomainDialog({
  domain,
  open,
  onOpenChange,
}: EditDomainDialogProps) {
  const { toast } = useToast();
  const updateDomain = useUpdateDomain();
  const { data: dnsProviders } = useDnsProviders();
  const [aliasInput, setAliasInput] = useState("");

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      displayName: domain.displayName || "",
      sslEnabled: domain.sslEnabled,
      forceHttps: domain.forceHttps,
      acmeVerificationMethod: domain.acmeVerificationMethod || "dns-01",
      acmeDnsProviderId: domain.acmeDnsProviderId || null,
      wwwRedirectEnabled: domain.wwwRedirectEnabled ?? false,
      subdomainAliases: domain.subdomainAliases ?? [],
    },
  });

  useEffect(() => {
    form.reset({
      displayName: domain.displayName || "",
      sslEnabled: domain.sslEnabled,
      forceHttps: domain.forceHttps,
      acmeVerificationMethod: domain.acmeVerificationMethod || "dns-01",
      acmeDnsProviderId: domain.acmeDnsProviderId || null,
      wwwRedirectEnabled: domain.wwwRedirectEnabled ?? false,
      subdomainAliases: domain.subdomainAliases ?? [],
    });
    setAliasInput("");
  }, [domain, form]);

  const sslEnabled = form.watch("sslEnabled");
  const acmeVerificationMethod = form.watch("acmeVerificationMethod");
  const wwwRedirectEnabled = form.watch("wwwRedirectEnabled");
  const subdomainAliases = form.watch("subdomainAliases");

  const addAlias = () => {
    const trimmed = aliasInput.trim().toLowerCase();
    if (!trimmed) return;
    const current = form.getValues("subdomainAliases");
    if (!current.includes(trimmed)) {
      form.setValue("subdomainAliases", [...current, trimmed]);
    }
    setAliasInput("");
  };

  const removeAlias = (alias: string) => {
    const current = form.getValues("subdomainAliases");
    form.setValue("subdomainAliases", current.filter((a) => a !== alias));
    // If this was the www alias and it's being removed manually, sync the toggle
    if (alias === `www.${domain.hostname}`) {
      form.setValue("wwwRedirectEnabled", false);
    }
  };

  const onSubmit = async (data: FormData) => {
    try {
      await updateDomain.mutateAsync({
        id: domain.id,
        data: {
          displayName: data.displayName || undefined,
          sslEnabled: data.sslEnabled,
          forceHttps: data.forceHttps,
          acmeVerificationMethod: data.acmeVerificationMethod,
          acmeDnsProviderId: data.acmeDnsProviderId,
          wwwRedirectEnabled: data.wwwRedirectEnabled,
          subdomainAliases: data.subdomainAliases,
        },
      });

      toast({
        title: "Domain updated",
        description: `${domain.hostname} has been updated successfully.`,
      });

      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to update domain",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Domain</DialogTitle>
          <DialogDescription>
            Update settings for {domain.hostname}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Name</FormLabel>
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
                      Use SSL/TLS for this domain
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

            <FormField
              control={form.control}
              name="wwwRedirectEnabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Also serve www.{domain.hostname}</FormLabel>
                    <FormDescription>
                      Route www.{domain.hostname} to the same backends
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={(checked) => {
                        field.onChange(checked);
                        const current = form.getValues("subdomainAliases");
                        const wwwAlias = `www.${domain.hostname}`;
                        if (checked && !current.includes(wwwAlias)) {
                          form.setValue("subdomainAliases", [wwwAlias, ...current]);
                        } else if (!checked) {
                          form.setValue("subdomainAliases", current.filter((a) => a !== wwwAlias));
                        }
                      }}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormItem>
              <FormLabel>Additional Aliases</FormLabel>
              <div className="flex gap-2">
                <Input
                  placeholder="alias.example.com"
                  value={aliasInput}
                  onChange={(e) => setAliasInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addAlias();
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={addAlias}>
                  Add
                </Button>
              </div>
              <FormDescription>
                Certificate must cover all aliases. Wildcard or multi-SAN certificate required for SSL.
              </FormDescription>
              {subdomainAliases.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {subdomainAliases.map((alias) => (
                    <span
                      key={alias}
                      className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-sm"
                    >
                      {alias}
                      <button
                        type="button"
                        onClick={() => removeAlias(alias)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </FormItem>

            {sslEnabled && (
              <>
                <FormField
                  control={form.control}
                  name="acmeVerificationMethod"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ACME Verification Method</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
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
                          "Automatically creates DNS TXT records via your DNS provider API."}
                        {acmeVerificationMethod === "http-01" &&
                          "Uses HTTP validation on your domain."}
                        {acmeVerificationMethod === "none" &&
                          "Manual certificate management. You can upload a certificate manually."}
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
                        <Select
                          onValueChange={field.onChange}
                          value={field.value || undefined}
                        >
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
                          The DNS provider used for domain verification.
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
              <Button type="submit" disabled={updateDomain.isPending}>
                {updateDomain.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

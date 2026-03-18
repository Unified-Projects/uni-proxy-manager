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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useToast,
} from "@uni-proxy-manager/ui";
import { useRequestCertificate } from "@/hooks/use-certificates";
import { useDomains } from "@/hooks/use-domains";
import { useDnsProviders } from "@/hooks/use-dns-providers";

const formSchema = z.object({
  domainId: z.string().min(1, "Domain is required"),
  dnsProviderId: z.string().optional(),
  altNames: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface RequestCertificateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RequestCertificateDialog({
  open,
  onOpenChange,
}: RequestCertificateDialogProps) {
  const { toast } = useToast();
  const requestCertificate = useRequestCertificate();
  const { data: domains } = useDomains();
  const { data: dnsProviders } = useDnsProviders();
  const defaultDnsOptionValue = "use-default-provider";

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      domainId: "",
      dnsProviderId: "",
      altNames: "",
    },
  });

  const onSubmit = async (data: FormData) => {
    try {
      // Parse altNames from comma/newline separated string to array
      const altNamesArray = data.altNames
        ?.split(/[,\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      await requestCertificate.mutateAsync({
        domainId: data.domainId,
        dnsProviderId: data.dnsProviderId || undefined,
        altNames: altNamesArray?.length ? altNamesArray : undefined,
      });

      toast({
        title: "Certificate requested",
        description: "Certificate issuance has been initiated.",
      });

      form.reset();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to request certificate",
        variant: "destructive",
      });
    }
  };

  // Filter domains that don't have certificates OR have failed certificates
  const availableDomains = domains?.filter(d =>
    !d.certificateId ||
    d.certificate?.status === "failed" ||
    d.certificate?.status === "pending"
  ) ?? [];
  const hasAvailableDomains = availableDomains.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Request Certificate</DialogTitle>
          <DialogDescription>
            Request a new SSL/TLS certificate from Let&apos;s Encrypt.
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
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={!hasAvailableDomains}
                  >
                    <FormControl>
                      <SelectTrigger disabled={!hasAvailableDomains}>
                        <SelectValue
                          placeholder={
                            hasAvailableDomains ? "Select a domain" : "No domains available"
                          }
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {hasAvailableDomains ? (
                        availableDomains.map((domain) => (
                          <SelectItem key={domain.id} value={domain.id}>
                            {domain.hostname}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="no-domains" disabled>
                          No domains available
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Select the domain to issue a certificate for
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="dnsProviderId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>DNS Provider (optional)</FormLabel>
                  <Select
                    onValueChange={(value) =>
                      field.onChange(value === defaultDnsOptionValue ? "" : value)
                    }
                    value={field.value || defaultDnsOptionValue}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Use default provider" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={defaultDnsOptionValue}>Use default provider</SelectItem>
                      {dnsProviders?.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.name} ({provider.type})
                          {provider.isDefault && " - Default"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    DNS provider for DNS-01 challenge validation
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="altNames"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Alternative Names (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="www.example.com&#10;api.example.com&#10;*.staging.example.com"
                      className="min-h-[80px]"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Additional domain names to include in the certificate (SAN).
                    Enter one per line or comma-separated. Supports wildcards (*.example.com).
                  </FormDescription>
                  <FormMessage />
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
              <Button type="submit" disabled={requestCertificate.isPending}>
                {requestCertificate.isPending ? "Requesting..." : "Request Certificate"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

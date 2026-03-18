"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  useToast,
} from "@uni-proxy-manager/ui";
import { useForm } from "react-hook-form";
import { useUpdatePomeriumIdp } from "@/hooks";
import type { PomeriumIdentityProvider, UpdatePomeriumIdpData, PomeriumIdpType } from "@/lib/types";

interface EditIdpDialogProps {
  idp: PomeriumIdentityProvider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditIdpDialog({ idp, open, onOpenChange }: EditIdpDialogProps) {
  const [type, setType] = useState<PomeriumIdpType>(idp.type);
  const updateIdp = useUpdatePomeriumIdp();
  const { toast } = useToast();

  const creds = (idp.credentials || {}) as Record<string, string>;

  const form = useForm<UpdatePomeriumIdpData>({
    defaultValues: {
      name: idp.name,
      displayName: idp.displayName || "",
      credentials: {
        clientId: creds.clientId || "",
        clientSecret: "",
        tenantId: creds.tenantId || "",
        hostedDomain: creds.hostedDomain || "",
        issuerUrl: creds.issuerUrl || "",
      },
      enabled: idp.enabled,
      isDefault: idp.isDefault,
    },
  });

  useEffect(() => {
    if (open) {
      const c = (idp.credentials || {}) as Record<string, string>;
      setType(idp.type);
      form.reset({
        name: idp.name,
        displayName: idp.displayName || "",
        credentials: {
          clientId: c.clientId || "",
          clientSecret: "",
          tenantId: c.tenantId || "",
          hostedDomain: c.hostedDomain || "",
          issuerUrl: c.issuerUrl || "",
        },
        enabled: idp.enabled,
        isDefault: idp.isDefault,
      });
    }
  }, [open, idp, form]);

  const onSubmit = async (data: UpdatePomeriumIdpData) => {
    try {
      const submitData: UpdatePomeriumIdpData = { ...data };

      // Strip all empty string credential fields - the API uses .partial() so undefined
      // is fine but "" fails min(1) validation. Server merges with existing values.
      if (submitData.credentials) {
        const c = submitData.credentials as Record<string, string | undefined>;
        for (const key of Object.keys(c)) {
          if (c[key] === "") delete c[key];
        }
        // If no credential fields remain, omit the object entirely
        if (Object.keys(c).length === 0) {
          delete submitData.credentials;
        }
      }

      await updateIdp.mutateAsync({ id: idp.id, data: submitData });

      toast({
        title: "Identity provider updated",
        description: `${data.name} has been updated successfully.`,
      });

      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update identity provider",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Identity Provider</DialogTitle>
          <DialogDescription>
            Update the identity provider configuration. Leave the client secret
            empty to keep the existing value.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 overflow-y-auto flex-1 pr-2">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="My Google Auth"
              {...form.register("name", { required: true })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name (Optional)</Label>
            <Input
              id="displayName"
              placeholder="Sign in with Google"
              {...form.register("displayName")}
            />
          </div>

          <div className="space-y-2">
            <Label>Provider Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as PomeriumIdpType)}>
              <SelectTrigger>
                <SelectValue placeholder="Select provider type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="google">Google Workspace</SelectItem>
                <SelectItem value="azure">Microsoft Entra ID</SelectItem>
                <SelectItem value="github">GitHub</SelectItem>
                <SelectItem value="oidc">Generic OIDC</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="clientId">Client ID</Label>
            <Input
              id="clientId"
              {...form.register("credentials.clientId")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="clientSecret">Client Secret</Label>
            <Input
              id="clientSecret"
              type="password"
              placeholder="Leave empty to keep existing"
              {...form.register("credentials.clientSecret")}
            />
          </div>

          {type === "azure" && (
            <div className="space-y-2">
              <Label htmlFor="tenantId">Tenant ID</Label>
              <Input
                id="tenantId"
                {...form.register("credentials.tenantId")}
              />
            </div>
          )}

          {type === "google" && (
            <div className="space-y-2">
              <Label htmlFor="hostedDomain">Hosted Domain (Optional)</Label>
              <Input
                id="hostedDomain"
                placeholder="example.com"
                {...form.register("credentials.hostedDomain")}
              />
              <p className="text-sm text-muted-foreground">
                Restrict to a specific Google Workspace domain.
              </p>
            </div>
          )}

          {type === "oidc" && (
            <div className="space-y-2">
              <Label htmlFor="issuerUrl">Issuer URL</Label>
              <Input
                id="issuerUrl"
                placeholder="https://your-provider.com"
                {...form.register("credentials.issuerUrl")}
              />
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enabled</Label>
              <p className="text-sm text-muted-foreground">
                Enable this provider for authentication.
              </p>
            </div>
            <Switch
              checked={form.watch("enabled")}
              onCheckedChange={(checked) => form.setValue("enabled", checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Set as Default</Label>
              <p className="text-sm text-muted-foreground">
                Use this provider by default for new routes.
              </p>
            </div>
            <Switch
              checked={form.watch("isDefault")}
              onCheckedChange={(checked) => form.setValue("isDefault", checked)}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updateIdp.isPending}>
              {updateIdp.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
} from "@uni-proxy-manager/ui";
import { useForm } from "react-hook-form";
import { useCreatePomeriumIdp } from "@/hooks";
import type { CreatePomeriumIdpData, PomeriumIdpType } from "@/lib/types";

interface CreateIdpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maxProvidersReached?: boolean;
}

export function CreateIdpDialog({
  open,
  onOpenChange,
  maxProvidersReached = false,
}: CreateIdpDialogProps) {
  const [type, setType] = useState<PomeriumIdpType>("google");
  const createIdp = useCreatePomeriumIdp();

  const form = useForm<CreatePomeriumIdpData>({
    defaultValues: {
      name: "",
      displayName: "",
      type: "google",
      credentials: {
        clientId: "",
        clientSecret: "",
      },
      enabled: true,
      isDefault: false,
    },
  });

  const onSubmit = async (data: CreatePomeriumIdpData) => {
    if (maxProvidersReached) {
      return;
    }

    await createIdp.mutateAsync({
      ...data,
      type,
    });
    form.reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Identity Provider</DialogTitle>
          <DialogDescription>
            Configure a new identity provider for user authentication.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4 overflow-y-auto flex-1 pr-2"
        >
          {maxProvidersReached && (
            <Alert>
              <AlertTitle>Provider already configured</AlertTitle>
              <AlertDescription>
                Pomerium currently supports one OAuth provider. Edit or delete
                the existing provider before creating a new one.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="My Google Auth"
              {...form.register("name", { required: true })}
              disabled={maxProvidersReached}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name (Optional)</Label>
            <Input
              id="displayName"
              placeholder="Sign in with Google"
              {...form.register("displayName")}
              disabled={maxProvidersReached}
            />
          </div>

          <div className="space-y-2">
            <Label>Provider Type</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as PomeriumIdpType)}
              disabled={maxProvidersReached}
            >
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
              placeholder="your-client-id"
              {...form.register("credentials.clientId", { required: true })}
              disabled={maxProvidersReached}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="clientSecret">Client Secret</Label>
            <Input
              id="clientSecret"
              type="password"
              placeholder="your-client-secret"
              {...form.register("credentials.clientSecret", { required: true })}
              disabled={maxProvidersReached}
            />
          </div>

          {type === "azure" && (
            <div className="space-y-2">
              <Label htmlFor="tenantId">Tenant ID</Label>
              <Input
                id="tenantId"
                placeholder="your-tenant-id"
                {...form.register("credentials.tenantId")}
                disabled={maxProvidersReached}
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
                disabled={maxProvidersReached}
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
                disabled={maxProvidersReached}
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
              disabled={maxProvidersReached}
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
              disabled={maxProvidersReached}
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
            <Button
              type="submit"
              disabled={createIdp.isPending || maxProvidersReached}
            >
              Create Provider
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

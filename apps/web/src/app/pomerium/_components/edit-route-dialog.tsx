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
  Textarea,
} from "@uni-proxy-manager/ui";
import { useForm } from "react-hook-form";
import { useUpdatePomeriumRoute, usePomeriumIdps } from "@/hooks";
import type { PomeriumRoute, UpdatePomeriumRouteData, PomeriumRouteProtection } from "@/lib/types";

interface EditRouteDialogProps {
  route: PomeriumRoute;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditRouteDialog({ route, open, onOpenChange }: EditRouteDialogProps) {
  const [protection, setProtection] = useState<PomeriumRouteProtection>(route.protection);
  const updateRoute = useUpdatePomeriumRoute();
  const { data: idps } = usePomeriumIdps();

  const form = useForm<UpdatePomeriumRouteData>({
    defaultValues: {
      name: route.name,
      pathPattern: route.pathPattern,
      protection: route.protection,
      identityProviderId: route.identityProviderId || "__default__",
      priority: route.priority,
      enabled: route.enabled,
      description: route.description || "",
      policyConfig: route.policyConfig || { passIdentityHeaders: true },
    },
  });

  useEffect(() => {
    if (open) {
      setProtection(route.protection);
      form.reset({
        name: route.name,
        pathPattern: route.pathPattern,
        protection: route.protection,
        identityProviderId: route.identityProviderId || "__default__",
        priority: route.priority,
        enabled: route.enabled,
        description: route.description || "",
        policyConfig: route.policyConfig || { passIdentityHeaders: true },
      });
    }
  }, [open, route, form]);

  const onSubmit = async (data: UpdatePomeriumRouteData) => {
    await updateRoute.mutateAsync({
      id: route.id,
      data: {
        ...data,
        protection,
        identityProviderId: data.identityProviderId === "__default__" ? null : data.identityProviderId,
      },
    });
    onOpenChange(false);
  };

  const defaultIdp = idps?.find(idp => idp.isDefault);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Protected Route</DialogTitle>
          <DialogDescription>
            Update the route configuration. Domain cannot be changed.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 overflow-y-auto flex-1 pr-2">
          <div className="space-y-2">
            <Label htmlFor="name">Route Name</Label>
            <Input
              id="name"
              placeholder="Admin Dashboard"
              {...form.register("name", { required: true })}
            />
          </div>

          <div className="space-y-2">
            <Label>Domain</Label>
            <Input
              value={route.domain?.hostname || "Unknown"}
              disabled
              className="bg-muted"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pathPattern">Path Pattern</Label>
            <Input
              id="pathPattern"
              placeholder="/*"
              {...form.register("pathPattern")}
            />
            <p className="text-sm text-muted-foreground">
              Use glob patterns: /* for all paths, /admin/* for admin paths, /api/v1/** for nested paths.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Protection Level</Label>
            <Select value={protection} onValueChange={(v) => setProtection(v as PomeriumRouteProtection)}>
              <SelectTrigger>
                <SelectValue placeholder="Select protection level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="protected">Protected (requires authentication)</SelectItem>
                <SelectItem value="public">Public (no authentication)</SelectItem>
                <SelectItem value="passthrough">Passthrough (no Pomerium processing)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {protection === "protected" && (
            <div className="space-y-2">
              <Label htmlFor="identityProviderId">Identity Provider</Label>
              <Select
                value={form.watch("identityProviderId") || ""}
                onValueChange={(v) => form.setValue("identityProviderId", v === "__default__" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={defaultIdp ? `Default: ${defaultIdp.displayName || defaultIdp.name}` : "Select provider"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">Use Default Provider</SelectItem>
                  {idps?.filter(idp => idp.enabled).map((idp) => (
                    <SelectItem key={idp.id} value={idp.id}>
                      {idp.displayName || idp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="priority">Priority</Label>
            <Input
              id="priority"
              type="number"
              placeholder="100"
              {...form.register("priority", { valueAsNumber: true })}
            />
            <p className="text-sm text-muted-foreground">
              Higher priority routes are evaluated first. Default is 100.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              placeholder="Route description..."
              {...form.register("description")}
              rows={2}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enabled</Label>
              <p className="text-sm text-muted-foreground">
                Enable this route.
              </p>
            </div>
            <Switch
              checked={form.watch("enabled")}
              onCheckedChange={(checked) => form.setValue("enabled", checked)}
            />
          </div>

          {protection === "protected" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="allowedGroups">Allowed Groups</Label>
                <Textarea
                  id="allowedGroups"
                  placeholder="admins&#10;developers&#10;managers"
                  rows={2}
                  value={(form.watch("policyConfig.allowedGroups") || []).join("\n")}
                  onChange={(e) => {
                    const groups = e.target.value
                      .split(/[\n,]/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                    form.setValue("policyConfig.allowedGroups", groups.length > 0 ? groups : undefined);
                  }}
                />
                <p className="text-sm text-muted-foreground">
                  Restrict access to specific IdP groups. Leave empty to allow any authenticated user.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="allowedUsers">Allowed Users</Label>
                <Textarea
                  id="allowedUsers"
                  placeholder="user@example.com&#10;admin@company.com"
                  rows={2}
                  value={(form.watch("policyConfig.allowedUsers") || []).join("\n")}
                  onChange={(e) => {
                    const users = e.target.value
                      .split(/[\n,]/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                    form.setValue("policyConfig.allowedUsers", users.length > 0 ? users : undefined);
                  }}
                />
                <p className="text-sm text-muted-foreground">
                  Restrict access to specific email addresses.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="allowedDomains">Allowed Domains</Label>
                <Textarea
                  id="allowedDomains"
                  placeholder="example.com&#10;company.org"
                  rows={2}
                  value={(form.watch("policyConfig.allowedDomains") || []).join("\n")}
                  onChange={(e) => {
                    const domains = e.target.value
                      .split(/[\n,]/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                    form.setValue("policyConfig.allowedDomains", domains.length > 0 ? domains : undefined);
                  }}
                />
                <p className="text-sm text-muted-foreground">
                  Restrict access to users from specific email domains.
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Pass Identity Headers</Label>
                  <p className="text-sm text-muted-foreground">
                    Include user identity in request headers.
                  </p>
                </div>
                <Switch
                  checked={form.watch("policyConfig.passIdentityHeaders") ?? true}
                  onCheckedChange={(checked) => form.setValue("policyConfig.passIdentityHeaders", checked)}
                />
              </div>
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
            <Button type="submit" disabled={updateRoute.isPending}>
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

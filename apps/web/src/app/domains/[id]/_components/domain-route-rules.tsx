"use client";

import { useState, useEffect } from "react";
import { ColumnDef } from "@tanstack/react-table";
import {
  MoreHorizontal,
  Route,
  Plus,
  GripVertical,
  ArrowRight,
  Server,
  ExternalLink,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  DataTableColumnHeader,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  useToast,
  Skeleton,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uni-proxy-manager/ui";
import type { DomainRouteRule, Backend, RouteActionType } from "@/lib/types";
import { useBackends } from "@/hooks/use-backends";
import {
  useDomainRouteRules,
  useCreateDomainRouteRule,
  useUpdateDomainRouteRule,
  useDeleteDomainRouteRule,
  useToggleDomainRouteRule,
} from "@/hooks/use-domain-advanced-config";

interface DomainRouteRulesProps {
  domainId: string;
}

export function DomainRouteRules({ domainId }: DomainRouteRulesProps) {
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedRule, setSelectedRule] = useState<DomainRouteRule | null>(null);

  const { data: routeRules, isLoading } = useDomainRouteRules(domainId);
  const { data: backends } = useBackends(domainId);
  const createRule = useCreateDomainRouteRule();
  const updateRule = useUpdateDomainRouteRule();
  const deleteRule = useDeleteDomainRouteRule();
  const toggleRule = useToggleDomainRouteRule();

  const handleToggle = async (rule: DomainRouteRule) => {
    try {
      await toggleRule.mutateAsync(rule.id);
      toast({
        title: rule.enabled ? "Rule disabled" : "Rule enabled",
        description: `Route rule "${rule.name}" has been ${rule.enabled ? "disabled" : "enabled"}.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to toggle rule",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!selectedRule) return;
    try {
      await deleteRule.mutateAsync(selectedRule.id);
      toast({
        title: "Rule deleted",
        description: `Route rule "${selectedRule.name}" has been deleted.`,
      });
      setDeleteDialogOpen(false);
      setSelectedRule(null);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete rule",
        variant: "destructive",
      });
    }
  };

  const columns: ColumnDef<DomainRouteRule>[] = [
    {
      accessorKey: "priority",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Priority" />
      ),
      cell: ({ row }) => {
        return (
          <div className="flex items-center gap-2">
            <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
            <Badge variant="outline">{row.original.priority}</Badge>
          </div>
        );
      },
    },
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Name" />
      ),
      cell: ({ row }) => {
        return (
          <div className="flex items-center gap-2">
            <Route className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{row.original.name}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "pathPattern",
      header: "Path Pattern",
      cell: ({ row }) => {
        return (
          <code className="text-sm bg-muted px-2 py-1 rounded">
            {row.original.pathPattern}
          </code>
        );
      },
    },
    {
      accessorKey: "actionType",
      header: "Target",
      cell: ({ row }) => {
        const rule = row.original;
        if (rule.actionType === "redirect") {
          return (
            <div className="flex items-center gap-2">
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <ExternalLink className="h-4 w-4 text-orange-500" />
              <span className="truncate max-w-[200px]" title={rule.redirectUrl || undefined}>
                {rule.redirectUrl}
              </span>
              <Badge variant="outline" className="ml-1 text-xs">
                {rule.redirectStatusCode}
              </Badge>
            </div>
          );
        }
        const backend = backends?.find((b) => b.id === rule.backendId);
        return (
          <div className="flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <Server className="h-4 w-4 text-blue-500" />
            <span>{backend?.name || "Unknown"}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "enabled",
      header: "Status",
      cell: ({ row }) => {
        const rule = row.original;
        return (
          <div className="flex items-center gap-2">
            <Badge variant={rule.enabled ? "default" : "secondary"}>
              {rule.enabled ? "Enabled" : "Disabled"}
            </Badge>
            <Switch
              checked={rule.enabled}
              onCheckedChange={() => handleToggle(rule)}
              disabled={toggleRule.isPending}
            />
          </div>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const rule = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => {
                  setSelectedRule(rule);
                  setEditDialogOpen(true);
                }}
              >
                Edit Rule
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  setSelectedRule(rule);
                  setDeleteDialogOpen(true);
                }}
              >
                Delete Rule
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-96" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Route Rules</CardTitle>
            <CardDescription>
              Configure URI-based routing to direct different paths to specific backends
            </CardDescription>
          </div>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Route Rule
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={routeRules || []}
            isLoading={isLoading}
            searchKey="name"
            searchPlaceholder="Search route rules..."
            emptyMessage="No route rules configured. Add a rule to route specific paths to different backends."
            showColumnToggle={false}
          />
        </CardContent>
      </Card>

      <CreateRouteRuleDialog
        domainId={domainId}
        backends={backends || []}
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />

      <EditRouteRuleDialog
        rule={selectedRule}
        backends={backends || []}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Route Rule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the route rule &quot;{selectedRule?.name}&quot;?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteRule.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface CreateRouteRuleDialogProps {
  domainId: string;
  backends: Backend[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CreateRouteRuleDialog({
  domainId,
  backends,
  open,
  onOpenChange,
}: CreateRouteRuleDialogProps) {
  const { toast } = useToast();
  const createRule = useCreateDomainRouteRule();

  const [name, setName] = useState("");
  const [pathPattern, setPathPattern] = useState("");
  const [actionType, setActionType] = useState<RouteActionType>("backend");
  const [backendId, setBackendId] = useState("");
  const [redirectUrl, setRedirectUrl] = useState("");
  const [redirectStatusCode, setRedirectStatusCode] = useState("302");
  const [redirectPreservePath, setRedirectPreservePath] = useState(false);
  const [redirectPreserveQuery, setRedirectPreserveQuery] = useState(true);
  const [priority, setPriority] = useState("100");
  const [description, setDescription] = useState("");

  const resetForm = () => {
    setName("");
    setPathPattern("");
    setActionType("backend");
    setBackendId("");
    setRedirectUrl("");
    setRedirectStatusCode("302");
    setRedirectPreservePath(false);
    setRedirectPreserveQuery(true);
    setPriority("100");
    setDescription("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name || !pathPattern) {
      toast({
        title: "Validation Error",
        description: "Please fill in name and path pattern.",
        variant: "destructive",
      });
      return;
    }

    if (actionType === "backend" && !backendId) {
      toast({
        title: "Validation Error",
        description: "Please select a target backend.",
        variant: "destructive",
      });
      return;
    }

    if (actionType === "redirect" && !redirectUrl) {
      toast({
        title: "Validation Error",
        description: "Please enter a redirect URL.",
        variant: "destructive",
      });
      return;
    }

    try {
      await createRule.mutateAsync({
        domainId,
        name,
        pathPattern,
        actionType,
        backendId: actionType === "backend" ? backendId : undefined,
        redirectUrl: actionType === "redirect" ? redirectUrl : undefined,
        redirectStatusCode: actionType === "redirect" ? parseInt(redirectStatusCode, 10) : undefined,
        redirectPreservePath: actionType === "redirect" ? redirectPreservePath : undefined,
        redirectPreserveQuery: actionType === "redirect" ? redirectPreserveQuery : undefined,
        priority: parseInt(priority, 10),
        description: description || undefined,
      });
      toast({
        title: "Route rule created",
        description: `Route rule "${name}" has been created.`,
      });
      resetForm();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create rule",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Create Route Rule</DialogTitle>
          <DialogDescription>
            Create a new URI-based routing rule for this domain
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="grid gap-4 py-4 overflow-y-auto flex-1 pr-2">
            <div className="grid gap-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="API Routes"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="pathPattern">Path Pattern *</Label>
              <Input
                id="pathPattern"
                value={pathPattern}
                onChange={(e) => setPathPattern(e.target.value)}
                placeholder="/api/*, /short-link, /go/*"
              />
              <p className="text-xs text-muted-foreground">
                Use glob patterns like /api/*, multiple paths /a,/b, or regex ^/api/(v1|v2)/.*
              </p>
            </div>

            <div className="grid gap-2">
              <Label>Action Type *</Label>
              <Select value={actionType} onValueChange={(v) => setActionType(v as RouteActionType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="backend">Route to Backend</SelectItem>
                  <SelectItem value="redirect">Redirect to URL</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {actionType === "backend" && (
              <div className="grid gap-2">
                <Label htmlFor="backend">Target Backend *</Label>
                <Select value={backendId} onValueChange={setBackendId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a backend" />
                  </SelectTrigger>
                  <SelectContent>
                    {backends.map((backend) => (
                      <SelectItem key={backend.id} value={backend.id}>
                        {backend.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {actionType === "redirect" && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="redirectUrl">Redirect URL *</Label>
                  <Input
                    id="redirectUrl"
                    value={redirectUrl}
                    onChange={(e) => setRedirectUrl(e.target.value)}
                    placeholder="https://example.com/destination"
                  />
                  <p className="text-xs text-muted-foreground">
                    The URL to redirect matching requests to
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="redirectStatusCode">HTTP Status Code</Label>
                  <Select value={redirectStatusCode} onValueChange={setRedirectStatusCode}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="301">301 - Permanent Redirect</SelectItem>
                      <SelectItem value="302">302 - Temporary Redirect (Default)</SelectItem>
                      <SelectItem value="303">303 - See Other</SelectItem>
                      <SelectItem value="307">307 - Temporary Redirect (Preserve Method)</SelectItem>
                      <SelectItem value="308">308 - Permanent Redirect (Preserve Method)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Preserve Path</Label>
                    <p className="text-xs text-muted-foreground">
                      Append the matched path to the redirect URL
                    </p>
                  </div>
                  <Switch
                    checked={redirectPreservePath}
                    onCheckedChange={setRedirectPreservePath}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Preserve Query String</Label>
                    <p className="text-xs text-muted-foreground">
                      Keep the original query parameters in the redirect
                    </p>
                  </div>
                  <Switch
                    checked={redirectPreserveQuery}
                    onCheckedChange={setRedirectPreserveQuery}
                  />
                </div>
              </>
            )}

            <div className="grid gap-2">
              <Label htmlFor="priority">Priority</Label>
              <Input
                id="priority"
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                placeholder="100"
              />
              <p className="text-xs text-muted-foreground">
                Lower numbers = higher priority. Default is 100.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description for this route rule"
              />
            </div>
          </div>
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createRule.isPending}>
              {createRule.isPending ? "Creating..." : "Create Rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface EditRouteRuleDialogProps {
  rule: DomainRouteRule | null;
  backends: Backend[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function EditRouteRuleDialog({
  rule,
  backends,
  open,
  onOpenChange,
}: EditRouteRuleDialogProps) {
  const { toast } = useToast();
  const updateRule = useUpdateDomainRouteRule();

  const [name, setName] = useState("");
  const [pathPattern, setPathPattern] = useState("");
  const [actionType, setActionType] = useState<RouteActionType>("backend");
  const [backendId, setBackendId] = useState("");
  const [redirectUrl, setRedirectUrl] = useState("");
  const [redirectStatusCode, setRedirectStatusCode] = useState("302");
  const [redirectPreservePath, setRedirectPreservePath] = useState(false);
  const [redirectPreserveQuery, setRedirectPreserveQuery] = useState(true);
  const [priority, setPriority] = useState("100");
  const [description, setDescription] = useState("");

  // Initialize form when dialog opens with a rule
  useEffect(() => {
    if (open && rule) {
      setName(rule.name);
      setPathPattern(rule.pathPattern);
      setActionType(rule.actionType || "backend");
      setBackendId(rule.backendId || "");
      setRedirectUrl(rule.redirectUrl || "");
      setRedirectStatusCode(String(rule.redirectStatusCode || 302));
      setRedirectPreservePath(rule.redirectPreservePath || false);
      setRedirectPreserveQuery(rule.redirectPreserveQuery ?? true);
      setPriority(String(rule.priority));
      setDescription(rule.description || "");
    }
  }, [open, rule]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!rule || !name || !pathPattern) {
      toast({
        title: "Validation Error",
        description: "Please fill in name and path pattern.",
        variant: "destructive",
      });
      return;
    }

    if (actionType === "backend" && !backendId) {
      toast({
        title: "Validation Error",
        description: "Please select a target backend.",
        variant: "destructive",
      });
      return;
    }

    if (actionType === "redirect" && !redirectUrl) {
      toast({
        title: "Validation Error",
        description: "Please enter a redirect URL.",
        variant: "destructive",
      });
      return;
    }

    try {
      await updateRule.mutateAsync({
        id: rule.id,
        data: {
          name,
          pathPattern,
          actionType,
          backendId: actionType === "backend" ? backendId : null,
          redirectUrl: actionType === "redirect" ? redirectUrl : null,
          redirectStatusCode: actionType === "redirect" ? parseInt(redirectStatusCode, 10) : undefined,
          redirectPreservePath: actionType === "redirect" ? redirectPreservePath : undefined,
          redirectPreserveQuery: actionType === "redirect" ? redirectPreserveQuery : undefined,
          priority: parseInt(priority, 10),
          description: description || null,
        },
      });
      toast({
        title: "Route rule updated",
        description: `Route rule "${name}" has been updated.`,
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update rule",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Edit Route Rule</DialogTitle>
          <DialogDescription>
            Update the URI-based routing rule
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="grid gap-4 py-4 overflow-y-auto flex-1 pr-2">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Name *</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="API Routes"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-pathPattern">Path Pattern *</Label>
              <Input
                id="edit-pathPattern"
                value={pathPattern}
                onChange={(e) => setPathPattern(e.target.value)}
                placeholder="/api/*, /short-link, /go/*"
              />
              <p className="text-xs text-muted-foreground">
                Use glob patterns like /api/*, multiple paths /a,/b, or regex ^/api/(v1|v2)/.*
              </p>
            </div>

            <div className="grid gap-2">
              <Label>Action Type *</Label>
              <Select value={actionType} onValueChange={(v) => setActionType(v as RouteActionType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="backend">Route to Backend</SelectItem>
                  <SelectItem value="redirect">Redirect to URL</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {actionType === "backend" && (
              <div className="grid gap-2">
                <Label htmlFor="edit-backend">Target Backend *</Label>
                <Select value={backendId} onValueChange={setBackendId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a backend" />
                  </SelectTrigger>
                  <SelectContent>
                    {backends.map((backend) => (
                      <SelectItem key={backend.id} value={backend.id}>
                        {backend.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {actionType === "redirect" && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="edit-redirectUrl">Redirect URL *</Label>
                  <Input
                    id="edit-redirectUrl"
                    value={redirectUrl}
                    onChange={(e) => setRedirectUrl(e.target.value)}
                    placeholder="https://example.com/destination"
                  />
                  <p className="text-xs text-muted-foreground">
                    The URL to redirect matching requests to
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="edit-redirectStatusCode">HTTP Status Code</Label>
                  <Select value={redirectStatusCode} onValueChange={setRedirectStatusCode}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="301">301 - Permanent Redirect</SelectItem>
                      <SelectItem value="302">302 - Temporary Redirect (Default)</SelectItem>
                      <SelectItem value="303">303 - See Other</SelectItem>
                      <SelectItem value="307">307 - Temporary Redirect (Preserve Method)</SelectItem>
                      <SelectItem value="308">308 - Permanent Redirect (Preserve Method)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Preserve Path</Label>
                    <p className="text-xs text-muted-foreground">
                      Append the matched path to the redirect URL
                    </p>
                  </div>
                  <Switch
                    checked={redirectPreservePath}
                    onCheckedChange={setRedirectPreservePath}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Preserve Query String</Label>
                    <p className="text-xs text-muted-foreground">
                      Keep the original query parameters in the redirect
                    </p>
                  </div>
                  <Switch
                    checked={redirectPreserveQuery}
                    onCheckedChange={setRedirectPreserveQuery}
                  />
                </div>
              </>
            )}

            <div className="grid gap-2">
              <Label htmlFor="edit-priority">Priority</Label>
              <Input
                id="edit-priority"
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                placeholder="100"
              />
              <p className="text-xs text-muted-foreground">
                Lower numbers = higher priority. Default is 100.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description for this route rule"
              />
            </div>
          </div>
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateRule.isPending}>
              {updateRule.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

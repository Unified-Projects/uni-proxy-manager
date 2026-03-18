"use client";

import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Ban, Plus, AlertOctagon } from "lucide-react";
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
import type { DomainBlockedRoute } from "@/lib/types";
import {
  useDomainBlockedRoutes,
  useCreateDomainBlockedRoute,
  useUpdateDomainBlockedRoute,
  useDeleteDomainBlockedRoute,
  useToggleDomainBlockedRoute,
} from "@/hooks/use-domain-advanced-config";

interface DomainBlockedRoutesProps {
  domainId: string;
}

const HTTP_STATUS_CODES = [
  { value: "403", label: "403 - Forbidden" },
  { value: "404", label: "404 - Not Found" },
  { value: "410", label: "410 - Gone" },
  { value: "451", label: "451 - Unavailable For Legal Reasons" },
  { value: "503", label: "503 - Service Unavailable" },
];

export function DomainBlockedRoutes({ domainId }: DomainBlockedRoutesProps) {
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<DomainBlockedRoute | null>(null);

  const { data: blockedRoutes, isLoading } = useDomainBlockedRoutes(domainId);
  const createRoute = useCreateDomainBlockedRoute();
  const updateRoute = useUpdateDomainBlockedRoute();
  const deleteRoute = useDeleteDomainBlockedRoute();
  const toggleRoute = useToggleDomainBlockedRoute();

  const handleToggle = async (route: DomainBlockedRoute) => {
    try {
      await toggleRoute.mutateAsync(route.id);
      toast({
        title: route.enabled ? "Block rule disabled" : "Block rule enabled",
        description: `Path "${route.pathPattern}" blocking has been ${route.enabled ? "disabled" : "enabled"}.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to toggle block rule",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!selectedRoute) return;
    try {
      await deleteRoute.mutateAsync(selectedRoute.id);
      toast({
        title: "Block rule deleted",
        description: `Path "${selectedRoute.pathPattern}" block rule has been deleted.`,
      });
      setDeleteDialogOpen(false);
      setSelectedRoute(null);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete block rule",
        variant: "destructive",
      });
    }
  };

  const columns: ColumnDef<DomainBlockedRoute>[] = [
    {
      accessorKey: "pathPattern",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Path Pattern" />
      ),
      cell: ({ row }) => {
        return (
          <div className="flex items-center gap-2">
            <Ban className="h-4 w-4 text-red-500" />
            <code className="text-sm bg-muted px-2 py-1 rounded">
              {row.original.pathPattern}
            </code>
          </div>
        );
      },
    },
    {
      accessorKey: "httpStatusCode",
      header: "Response Code",
      cell: ({ row }) => {
        const code = row.original.httpStatusCode;
        return (
          <Badge variant="outline" className="font-mono">
            {code}
          </Badge>
        );
      },
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ row }) => {
        return (
          <span className="text-sm text-muted-foreground">
            {row.original.description || "-"}
          </span>
        );
      },
    },
    {
      accessorKey: "enabled",
      header: "Status",
      cell: ({ row }) => {
        const route = row.original;
        return (
          <div className="flex items-center gap-2">
            <Badge variant={route.enabled ? "destructive" : "secondary"}>
              {route.enabled ? "Blocking" : "Disabled"}
            </Badge>
            <Switch
              checked={route.enabled}
              onCheckedChange={() => handleToggle(route)}
              disabled={toggleRoute.isPending}
            />
          </div>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const route = row.original;
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
                  setSelectedRoute(route);
                  setEditDialogOpen(true);
                }}
              >
                Edit Rule
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  setSelectedRoute(route);
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
            <CardTitle className="flex items-center gap-2">
              <AlertOctagon className="h-5 w-5 text-red-500" />
              Blocked Routes
            </CardTitle>
            <CardDescription>
              Block specific paths from being accessed on this domain
            </CardDescription>
          </div>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Block Path
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={blockedRoutes || []}
            isLoading={isLoading}
            searchKey="pathPattern"
            searchPlaceholder="Search blocked paths..."
            emptyMessage="No blocked routes configured. Add a rule to block access to specific paths."
            showColumnToggle={false}
          />
        </CardContent>
      </Card>

      <CreateBlockedRouteDialog
        domainId={domainId}
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />

      <EditBlockedRouteDialog
        route={selectedRoute}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Block Rule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the block rule for &quot;{selectedRoute?.pathPattern}
              &quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteRoute.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface CreateBlockedRouteDialogProps {
  domainId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CreateBlockedRouteDialog({
  domainId,
  open,
  onOpenChange,
}: CreateBlockedRouteDialogProps) {
  const { toast } = useToast();
  const createRoute = useCreateDomainBlockedRoute();

  const [pathPattern, setPathPattern] = useState("");
  const [httpStatusCode, setHttpStatusCode] = useState("403");
  const [customResponseBody, setCustomResponseBody] = useState("");
  const [description, setDescription] = useState("");

  const resetForm = () => {
    setPathPattern("");
    setHttpStatusCode("403");
    setCustomResponseBody("");
    setDescription("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!pathPattern) {
      toast({
        title: "Validation Error",
        description: "Please enter a path pattern to block.",
        variant: "destructive",
      });
      return;
    }

    try {
      await createRoute.mutateAsync({
        domainId,
        pathPattern,
        httpStatusCode: parseInt(httpStatusCode, 10),
        customResponseBody: customResponseBody || undefined,
        description: description || undefined,
      });
      toast({
        title: "Block rule created",
        description: `Path "${pathPattern}" will now be blocked.`,
      });
      resetForm();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create block rule",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-red-500" />
            Block Path
          </DialogTitle>
          <DialogDescription>
            Create a new rule to block access to a specific path pattern
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="pathPattern">Path Pattern *</Label>
              <Input
                id="pathPattern"
                value={pathPattern}
                onChange={(e) => setPathPattern(e.target.value)}
                placeholder="/admin/*"
              />
              <p className="text-xs text-muted-foreground">
                Use glob patterns like /admin/*, /api/internal/**, /.env
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="statusCode">HTTP Status Code</Label>
              <Select value={httpStatusCode} onValueChange={setHttpStatusCode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HTTP_STATUS_CODES.map((code) => (
                    <SelectItem key={code.value} value={code.value}>
                      {code.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The HTTP status code to return when this path is accessed
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="responseBody">Custom Response Body</Label>
              <Textarea
                id="responseBody"
                value={customResponseBody}
                onChange={(e) => setCustomResponseBody(e.target.value)}
                placeholder="Access denied"
                className="min-h-[80px]"
              />
              <p className="text-xs text-muted-foreground">
                Optional custom message to return (leave empty for default HAProxy response)
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Block admin panel access"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createRoute.isPending} variant="destructive">
              {createRoute.isPending ? "Creating..." : "Block Path"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface EditBlockedRouteDialogProps {
  route: DomainBlockedRoute | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function EditBlockedRouteDialog({
  route,
  open,
  onOpenChange,
}: EditBlockedRouteDialogProps) {
  const { toast } = useToast();
  const updateRoute = useUpdateDomainBlockedRoute();

  const [pathPattern, setPathPattern] = useState("");
  const [httpStatusCode, setHttpStatusCode] = useState("403");
  const [customResponseBody, setCustomResponseBody] = useState("");
  const [description, setDescription] = useState("");

  // Reset form when dialog opens with a route
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen && route) {
      setPathPattern(route.pathPattern);
      setHttpStatusCode(String(route.httpStatusCode));
      setCustomResponseBody(route.customResponseBody || "");
      setDescription(route.description || "");
    }
    onOpenChange(newOpen);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!route || !pathPattern) {
      toast({
        title: "Validation Error",
        description: "Please enter a path pattern to block.",
        variant: "destructive",
      });
      return;
    }

    try {
      await updateRoute.mutateAsync({
        id: route.id,
        data: {
          pathPattern,
          httpStatusCode: parseInt(httpStatusCode, 10),
          customResponseBody: customResponseBody || null,
          description: description || null,
        },
      });
      toast({
        title: "Block rule updated",
        description: `Block rule for "${pathPattern}" has been updated.`,
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update block rule",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-red-500" />
            Edit Block Rule
          </DialogTitle>
          <DialogDescription>Update the path blocking rule</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-pathPattern">Path Pattern *</Label>
              <Input
                id="edit-pathPattern"
                value={pathPattern}
                onChange={(e) => setPathPattern(e.target.value)}
                placeholder="/admin/*"
              />
              <p className="text-xs text-muted-foreground">
                Use glob patterns like /admin/*, /api/internal/**, /.env
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-statusCode">HTTP Status Code</Label>
              <Select value={httpStatusCode} onValueChange={setHttpStatusCode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HTTP_STATUS_CODES.map((code) => (
                    <SelectItem key={code.value} value={code.value}>
                      {code.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-responseBody">Custom Response Body</Label>
              <Textarea
                id="edit-responseBody"
                value={customResponseBody}
                onChange={(e) => setCustomResponseBody(e.target.value)}
                placeholder="Access denied"
                className="min-h-[80px]"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-description">Description</Label>
              <Input
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Block admin panel access"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateRoute.isPending}>
              {updateRoute.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { Plus, MoreVertical, Trash2, Edit, ToggleLeft, ToggleRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Skeleton,
  Switch,
} from "@uni-proxy-manager/ui";
import {
  usePomeriumRoutes,
  useTogglePomeriumRoute,
} from "@/hooks";
import type { PomeriumRoute } from "@/lib/types";
import { CreateRouteDialog } from "./create-route-dialog";
import { EditRouteDialog } from "./edit-route-dialog";
import { DeleteRouteDialog } from "./delete-route-dialog";

const protectionLabels: Record<string, string> = {
  protected: "Protected",
  public: "Public",
  passthrough: "Passthrough",
};

const protectionColors: Record<string, string> = {
  protected: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  public: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  passthrough: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

export function ProtectedRoutesTab() {
  const { data: routes, isLoading } = usePomeriumRoutes();
  const [createOpen, setCreateOpen] = useState(false);
  const [editRoute, setEditRoute] = useState<PomeriumRoute | null>(null);
  const [deleteRoute, setDeleteRoute] = useState<PomeriumRoute | null>(null);

  const toggleRoute = useTogglePomeriumRoute();

  const handleToggle = async (route: PomeriumRoute) => {
    await toggleRoute.mutateAsync(route.id);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Protected Routes</CardTitle>
            <CardDescription>
              Configure which routes require authentication and access policies.
            </CardDescription>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Route
          </Button>
        </CardHeader>
        <CardContent>
          {routes && routes.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Protection</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {routes.map((route) => (
                  <TableRow key={route.id}>
                    <TableCell className="font-medium">{route.name}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {route.domain?.hostname || "-"}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {route.pathPattern}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={protectionColors[route.protection]}
                      >
                        {protectionLabels[route.protection] || route.protection}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {route.identityProvider?.name || "Default"}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={route.enabled}
                        onCheckedChange={() => handleToggle(route)}
                        disabled={toggleRoute.isPending}
                      />
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditRoute(route)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeleteRoute(route)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <p>No protected routes configured.</p>
              <p className="text-sm mt-1">
                Add a route to start protecting your domains.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateRouteDialog open={createOpen} onOpenChange={setCreateOpen} />

      {editRoute && (
        <EditRouteDialog
          route={editRoute}
          open={!!editRoute}
          onOpenChange={(open) => !open && setEditRoute(null)}
        />
      )}

      {deleteRoute && (
        <DeleteRouteDialog
          route={deleteRoute}
          open={!!deleteRoute}
          onOpenChange={(open) => !open && setDeleteRoute(null)}
        />
      )}
    </>
  );
}

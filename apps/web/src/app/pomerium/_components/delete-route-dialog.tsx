"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uni-proxy-manager/ui";
import { useDeletePomeriumRoute } from "@/hooks";
import type { PomeriumRoute } from "@/lib/types";

interface DeleteRouteDialogProps {
  route: PomeriumRoute;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteRouteDialog({ route, open, onOpenChange }: DeleteRouteDialogProps) {
  const deleteRoute = useDeletePomeriumRoute();

  const handleDelete = async () => {
    await deleteRoute.mutateAsync(route.id);
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Protected Route</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete the route &quot;{route.name}&quot; for{" "}
            {route.domain?.hostname || "this domain"}? This action cannot be undone.
            The path {route.pathPattern} will no longer be protected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={deleteRoute.isPending}
          >
            {deleteRoute.isPending ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

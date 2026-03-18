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
  useToast,
} from "@uni-proxy-manager/ui";
import { useDeleteMaintenancePage } from "@/hooks/use-maintenance-pages";
import type { ErrorPage } from "@/lib/types";

interface DeleteMaintenancePageDialogProps {
  maintenancePage: ErrorPage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteMaintenancePageDialog({
  maintenancePage,
  open,
  onOpenChange,
}: DeleteMaintenancePageDialogProps) {
  const { toast } = useToast();
  const deleteMaintenancePage = useDeleteMaintenancePage();

  const handleDelete = async () => {
    if (!maintenancePage) return;

    try {
      await deleteMaintenancePage.mutateAsync(maintenancePage.id);
      toast({
        title: "Maintenance page deleted",
        description: `${maintenancePage.name} has been deleted.`,
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Delete failed",
        description:
          error instanceof Error ? error.message : "Failed to delete maintenance page",
        variant: "destructive",
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Maintenance Page</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete "{maintenancePage?.name}"? This action
            cannot be undone and will remove all associated files.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteMaintenancePage.isPending ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

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
import { useDeleteBackend } from "@/hooks/use-backends";
import type { Backend } from "@/lib/types";

interface DeleteBackendDialogProps {
  backend: Backend | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteBackendDialog({
  backend,
  open,
  onOpenChange,
}: DeleteBackendDialogProps) {
  const { toast } = useToast();
  const deleteBackend = useDeleteBackend();

  const handleDelete = async () => {
    if (!backend) return;

    try {
      await deleteBackend.mutateAsync(backend.id);

      toast({
        title: "Backend deleted",
        description: `${backend.name} has been deleted successfully.`,
      });

      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to delete backend",
        variant: "destructive",
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Backend</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete{" "}
            <span className="font-semibold">{backend?.name}</span>? This action
            cannot be undone and will stop routing traffic to this server.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteBackend.isPending ? "Deleting..." : "Delete Backend"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

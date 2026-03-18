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
import { useDeleteErrorPage } from "@/hooks/use-error-pages";
import type { ErrorPage } from "@/lib/types";

interface DeleteErrorPageDialogProps {
  errorPage: ErrorPage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteErrorPageDialog({
  errorPage,
  open,
  onOpenChange,
}: DeleteErrorPageDialogProps) {
  const { toast } = useToast();
  const deleteErrorPage = useDeleteErrorPage();

  const handleDelete = async () => {
    if (!errorPage) return;

    try {
      await deleteErrorPage.mutateAsync(errorPage.id);

      toast({
        title: "Error page deleted",
        description: `${errorPage.name} has been deleted.`,
      });

      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to delete error page",
        variant: "destructive",
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Error Page</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete{" "}
            <span className="font-semibold">{errorPage?.name}</span>?
            <br />
            <br />
            Domains using this error page will fall back to the default error
            page until a new one is assigned.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteErrorPage.isPending ? "Deleting..." : "Delete Error Page"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

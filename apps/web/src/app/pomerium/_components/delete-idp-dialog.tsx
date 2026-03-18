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
import { useDeletePomeriumIdp } from "@/hooks";
import type { PomeriumIdentityProvider } from "@/lib/types";

interface DeleteIdpDialogProps {
  idp: PomeriumIdentityProvider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteIdpDialog({ idp, open, onOpenChange }: DeleteIdpDialogProps) {
  const deleteIdp = useDeletePomeriumIdp();

  const handleDelete = async () => {
    await deleteIdp.mutateAsync(idp.id);
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Identity Provider</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete the identity provider &quot;{idp.displayName || idp.name}&quot;?
            This action cannot be undone. Any routes using this provider will need
            to be reconfigured.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={deleteIdp.isPending}
          >
            {deleteIdp.isPending ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

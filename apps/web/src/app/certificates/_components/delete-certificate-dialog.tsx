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
import { useDeleteCertificate } from "@/hooks/use-certificates";
import type { Certificate } from "@/lib/types";

interface DeleteCertificateDialogProps {
  certificate: Certificate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteCertificateDialog({
  certificate,
  open,
  onOpenChange,
}: DeleteCertificateDialogProps) {
  const { toast } = useToast();
  const deleteCertificate = useDeleteCertificate();

  const handleDelete = async () => {
    if (!certificate) return;

    try {
      await deleteCertificate.mutateAsync(certificate.id);

      toast({
        title: "Certificate deleted",
        description: `Certificate for ${certificate.commonName} has been deleted.`,
      });

      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to delete certificate",
        variant: "destructive",
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Certificate</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete the certificate for{" "}
            <span className="font-semibold">{certificate?.commonName}</span>?
            <br />
            <br />
            This will remove the SSL/TLS certificate and the associated domain will
            no longer serve HTTPS traffic until a new certificate is issued.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteCertificate.isPending ? "Deleting..." : "Delete Certificate"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

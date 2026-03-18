"use client";

import { useState } from "react";
import { Plus, Shield, AlertCircle, Clock, CheckCircle2, Upload } from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uni-proxy-manager/ui";
import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useCertificates, useRenewCertificate, useDeleteCertificate } from "@/hooks/use-certificates";
import type { Certificate } from "@/lib/types";
import { format } from "date-fns";
import { RequestCertificateDialog } from "./_components/request-certificate-dialog";
import { DeleteCertificateDialog } from "./_components/delete-certificate-dialog";
import { UploadCertificateDialog } from "./_components/upload-certificate-dialog";

const statusColors: Record<string, string> = {
  active: "bg-green-500/10 text-green-500",
  pending: "bg-yellow-500/10 text-yellow-500",
  issuing: "bg-blue-500/10 text-blue-500",
  expired: "bg-red-500/10 text-red-500",
  failed: "bg-red-500/10 text-red-500",
  revoked: "bg-gray-500/10 text-gray-500",
};

const statusIcons: Record<string, React.ReactNode> = {
  active: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  pending: <Clock className="h-4 w-4 text-yellow-500" />,
  issuing: <Clock className="h-4 w-4 text-blue-500" />,
  expired: <AlertCircle className="h-4 w-4 text-red-500" />,
  failed: <AlertCircle className="h-4 w-4 text-red-500" />,
  revoked: <AlertCircle className="h-4 w-4 text-gray-500" />,
};

export default function CertificatesPage() {
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedCertificate, setSelectedCertificate] = useState<Certificate | null>(null);

  const { data: certificates, isLoading } = useCertificates();
  const renewCertificate = useRenewCertificate();

  const handleDeleteClick = (cert: Certificate) => {
    setSelectedCertificate(cert);
    setDeleteDialogOpen(true);
  };

  const columns: ColumnDef<Certificate>[] = [
    {
      accessorKey: "commonName",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Common Name" />
      ),
      cell: ({ row }) => {
        const cert = row.original;
        return (
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <Link
              href={`/certificates/${cert.id}`}
              className="font-medium hover:underline"
            >
              {cert.commonName}
            </Link>
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => {
        const status = row.getValue("status") as string;
        return (
          <div className="flex items-center gap-2">
            {statusIcons[status]}
            <Badge className={statusColors[status]}>{status}</Badge>
          </div>
        );
      },
    },
    {
      accessorKey: "expiresAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Expires" />
      ),
      cell: ({ row }) => {
        const expiresAt = row.getValue("expiresAt") as string | null;
        if (!expiresAt) return <span className="text-muted-foreground">-</span>;

        const date = new Date(expiresAt);
        const isExpiringSoon = date.getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;
        const isExpired = date < new Date();

        return (
          <span className={isExpired ? "text-red-500" : isExpiringSoon ? "text-yellow-500" : ""}>
            {format(date, "MMM d, yyyy")}
          </span>
        );
      },
    },
    {
      accessorKey: "autoRenew",
      header: "Auto Renew",
      cell: ({ row }) => {
        const autoRenew = row.getValue("autoRenew") as boolean;
        return (
          <Badge variant={autoRenew ? "default" : "outline"}>
            {autoRenew ? "Enabled" : "Disabled"}
          </Badge>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const cert = row.original;

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
              <DropdownMenuItem asChild>
                <Link href={`/certificates/${cert.id}`}>View Details</Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => renewCertificate.mutate(cert.id)}
                disabled={renewCertificate.isPending || cert.status !== "active"}
              >
                Force Renewal
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => handleDeleteClick(cert)}
              >
                Delete Certificate
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Certificates</h1>
          <p className="text-muted-foreground">
            Manage SSL/TLS certificates for your domains.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setUploadDialogOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Upload Certificate
          </Button>
          <Button onClick={() => setRequestDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Request Certificate
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Certificates</CardTitle>
          <CardDescription>
            {certificates?.length ?? 0} certificate{(certificates?.length ?? 0) !== 1 ? "s" : ""} configured
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={certificates ?? []}
            isLoading={isLoading}
            searchKey="commonName"
            searchPlaceholder="Search certificates..."
            emptyMessage="No certificates found. Request a certificate to get started."
          />
        </CardContent>
      </Card>

      <RequestCertificateDialog
        open={requestDialogOpen}
        onOpenChange={setRequestDialogOpen}
      />

      <UploadCertificateDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
      />

      <DeleteCertificateDialog
        certificate={selectedCertificate}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      />
    </div>
  );
}

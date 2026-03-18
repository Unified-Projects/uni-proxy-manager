"use client";

import { useState } from "react";
import { Plus, Cloud, CheckCircle2, XCircle, Star } from "lucide-react";
import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";
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
  useToast,
} from "@uni-proxy-manager/ui";
import { useDnsProviders, useTestDnsProvider, useSetDefaultDnsProvider, useDeleteDnsProvider } from "@/hooks/use-dns-providers";
import type { DnsProvider } from "@/lib/types";
import { format } from "date-fns";
import { CreateDnsProviderDialog } from "./_components/create-dns-provider-dialog";
import { EditDnsProviderDialog } from "./_components/edit-dns-provider-dialog";
import { DeleteDnsProviderDialog } from "./_components/delete-dns-provider-dialog";

export default function DnsProvidersPage() {
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<DnsProvider | null>(null);

  const { data: providers, isLoading } = useDnsProviders();
  const testProvider = useTestDnsProvider();
  const setDefaultProvider = useSetDefaultDnsProvider();

  const handleTest = async (provider: DnsProvider) => {
    try {
      const result = await testProvider.mutateAsync(provider.id);
      toast({
        title: result.success ? "Connection successful" : "Connection failed",
        description: result.message || (result.success ? "DNS provider is working correctly." : "Failed to connect to DNS provider."),
        variant: result.success ? "default" : "destructive",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to test provider",
        variant: "destructive",
      });
    }
  };

  const handleSetDefault = async (provider: DnsProvider) => {
    try {
      await setDefaultProvider.mutateAsync(provider.id);
      toast({
        title: "Default provider updated",
        description: `${provider.name} is now the default DNS provider.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to set default",
        variant: "destructive",
      });
    }
  };

  const handleEditClick = (provider: DnsProvider) => {
    setSelectedProvider(provider);
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (provider: DnsProvider) => {
    setSelectedProvider(provider);
    setDeleteDialogOpen(true);
  };

  const columns: ColumnDef<DnsProvider>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Name" />
      ),
      cell: ({ row }) => {
        const provider = row.original;
        return (
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{provider.name}</span>
            {provider.isDefault && (
              <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => {
        const type = row.getValue("type") as string;
        return (
          <Badge variant="outline" className="capitalize">
            {type}
          </Badge>
        );
      },
    },
    {
      accessorKey: "lastValidated",
      header: "Last Validated",
      cell: ({ row }) => {
        const provider = row.original;
        if (!provider.lastValidated) {
          return <span className="text-muted-foreground">Never</span>;
        }
        return (
          <div className="flex items-center gap-2">
            {provider.validationError ? (
              <XCircle className="h-4 w-4 text-red-500" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            )}
            <span>{format(new Date(provider.lastValidated), "MMM d, yyyy HH:mm")}</span>
          </div>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const provider = row.original;

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
                onClick={() => handleTest(provider)}
                disabled={testProvider.isPending}
              >
                Test Connection
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleEditClick(provider)}>
                Edit Provider
              </DropdownMenuItem>
              {!provider.isDefault && (
                <DropdownMenuItem
                  onClick={() => handleSetDefault(provider)}
                  disabled={setDefaultProvider.isPending}
                >
                  Set as Default
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => handleDeleteClick(provider)}
              >
                Delete Provider
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
          <h1 className="text-3xl font-bold">DNS Providers</h1>
          <p className="text-muted-foreground">
            Configure DNS providers for SSL certificate validation.
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Provider
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Providers</CardTitle>
          <CardDescription>
            {providers?.length ?? 0} provider{(providers?.length ?? 0) !== 1 ? "s" : ""} configured
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={providers ?? []}
            isLoading={isLoading}
            searchKey="name"
            searchPlaceholder="Search providers..."
            emptyMessage="No DNS providers configured. Add a provider to enable SSL certificates."
            showColumnToggle={false}
          />
        </CardContent>
      </Card>

      <CreateDnsProviderDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />

      <EditDnsProviderDialog
        provider={selectedProvider}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
      />

      <DeleteDnsProviderDialog
        provider={selectedProvider}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      />
    </div>
  );
}

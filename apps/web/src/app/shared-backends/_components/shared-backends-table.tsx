"use client";

import { useState } from "react";
import { MoreHorizontal, Trash2, Pencil, Link, Unlink, ToggleLeft, ToggleRight } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useToast,
} from "@uni-proxy-manager/ui";
import type { SharedBackend } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";
import { useDeleteSharedBackend, useToggleSharedBackend } from "@/hooks/use-shared-backends";
import { EditSharedBackendDialog } from "./edit-shared-backend-dialog";
import { LinkedDomainsPanel } from "./linked-domains-panel";

interface SharedBackendsTableProps {
  sharedBackends: SharedBackend[];
  isLoading: boolean;
}

export function SharedBackendsTable({ sharedBackends, isLoading }: SharedBackendsTableProps) {
  const { toast } = useToast();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [linkedDomainsPanelOpen, setLinkedDomainsPanelOpen] = useState(false);
  const [selectedBackend, setSelectedBackend] = useState<SharedBackend | null>(null);

  const deleteBackend = useDeleteSharedBackend();
  const toggleBackend = useToggleSharedBackend();

  const handleDelete = async (backend: SharedBackend) => {
    if (!confirm(`Delete shared backend "${backend.name}"? This will unlink it from all domains.`)) return;
    try {
      await deleteBackend.mutateAsync({ id: backend.id, force: true });
      toast({ title: "Shared backend deleted" });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete",
        variant: "destructive",
      });
    }
  };

  const handleToggle = async (backend: SharedBackend) => {
    try {
      await toggleBackend.mutateAsync(backend.id);
      toast({
        title: backend.enabled ? "Backend disabled" : "Backend enabled",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to toggle",
        variant: "destructive",
      });
    }
  };

  const columns: ColumnDef<SharedBackend>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.name}</div>
          {row.original.description && (
            <div className="text-xs text-muted-foreground">{row.original.description}</div>
          )}
        </div>
      ),
    },
    {
      header: "Address",
      cell: ({ row }) => (
        <span className="font-mono text-sm">
          {row.original.address}:{row.original.port}
        </span>
      ),
    },
    {
      accessorKey: "protocol",
      header: "Protocol",
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.protocol.toUpperCase()}</Badge>
      ),
    },
    {
      header: "Domains",
      cell: ({ row }) => (
        <Badge variant="secondary">{row.original.domainCount ?? 0} domains</Badge>
      ),
    },
    {
      header: "Health",
      cell: ({ row }) => (
        <Badge variant={row.original.isHealthy ? "default" : "destructive"}>
          {row.original.isHealthy ? "Healthy" : "Unhealthy"}
        </Badge>
      ),
    },
    {
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.enabled ? "default" : "secondary"}>
          {row.original.enabled ? "Enabled" : "Disabled"}
        </Badge>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => {
                setSelectedBackend(row.original);
                setEditDialogOpen(true);
              }}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setSelectedBackend(row.original);
                setLinkedDomainsPanelOpen(true);
              }}
            >
              <Link className="mr-2 h-4 w-4" />
              Manage Linked Domains
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleToggle(row.original)}>
              {row.original.enabled ? (
                <>
                  <ToggleLeft className="mr-2 h-4 w-4" />
                  Disable
                </>
              ) : (
                <>
                  <ToggleRight className="mr-2 h-4 w-4" />
                  Enable
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => handleDelete(row.original)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <>
      <DataTable columns={columns} data={sharedBackends} isLoading={isLoading} />

      {selectedBackend && (
        <>
          <EditSharedBackendDialog
            backend={selectedBackend}
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
          />
          <LinkedDomainsPanel
            backend={selectedBackend}
            open={linkedDomainsPanelOpen}
            onOpenChange={setLinkedDomainsPanelOpen}
          />
        </>
      )}
    </>
  );
}

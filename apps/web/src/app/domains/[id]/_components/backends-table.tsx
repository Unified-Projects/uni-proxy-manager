"use client";

import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Server, Activity, AlertCircle, Globe } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  DataTableColumnHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useToast,
} from "@uni-proxy-manager/ui";
import type { Backend } from "@/lib/types";
import { useUpdateBackend, useDeleteBackend } from "@/hooks/use-backends";
import { EditBackendDialog } from "./edit-backend-dialog";
import { DeleteBackendDialog } from "./delete-backend-dialog";

interface BackendsTableProps {
  backends: Backend[];
  isLoading: boolean;
}

export function BackendsTable({ backends, isLoading }: BackendsTableProps) {
  const { toast } = useToast();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedBackend, setSelectedBackend] = useState<Backend | null>(null);

  const updateBackend = useUpdateBackend();
  const deleteBackend = useDeleteBackend();

  const handleToggleEnabled = async (backend: Backend, enabled: boolean) => {
    try {
      await updateBackend.mutateAsync({
        id: backend.id,
        data: { enabled },
      });
      toast({
        title: enabled ? "Backend enabled" : "Backend disabled",
        description: `${backend.name} has been ${enabled ? "enabled" : "disabled"}.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update backend",
        variant: "destructive",
      });
    }
  };

  const handleEditClick = (backend: Backend) => {
    setSelectedBackend(backend);
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (backend: Backend) => {
    setSelectedBackend(backend);
    setDeleteDialogOpen(true);
  };

  const columns: ColumnDef<Backend>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Name" />
      ),
      cell: ({ row }) => {
        const backend = row.original;
        return (
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{backend.name}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "address",
      header: "Target",
      cell: ({ row }) => {
        const backend = row.original;
        if (backend.backendType === "site") {
          return (
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-blue-500" />
              <span className="text-sm">
                {backend.site?.name || "Site"}
              </span>
              <Badge variant="outline" className="text-xs">Site</Badge>
            </div>
          );
        }
        return (
          <code className="text-sm">
            {backend.protocol}://{backend.address}:{backend.port}
          </code>
        );
      },
    },
    {
      accessorKey: "isHealthy",
      header: "Health",
      cell: ({ row }) => {
        const backend = row.original;
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2">
                  {backend.isHealthy ? (
                    <>
                      <Activity className="h-4 w-4 text-green-500" />
                      <Badge className="bg-green-500/10 text-green-500">Healthy</Badge>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-4 w-4 text-red-500" />
                      <Badge className="bg-red-500/10 text-red-500">Unhealthy</Badge>
                    </>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {backend.lastHealthError || "No errors"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      },
    },
    {
      accessorKey: "weight",
      header: "Weight",
      cell: ({ row }) => {
        const weight = row.getValue("weight") as number;
        return <span>{weight}</span>;
      },
    },
    {
      accessorKey: "loadBalanceMethod",
      header: "LB Method",
      cell: ({ row }) => {
        const method = row.getValue("loadBalanceMethod") as string;
        return <Badge variant="outline">{method}</Badge>;
      },
    },
    {
      accessorKey: "enabled",
      header: "Status",
      cell: ({ row }) => {
        const backend = row.original;
        return (
          <div className="flex items-center gap-2">
            <Badge
              variant={backend.enabled ? "default" : "secondary"}
              className={backend.enabled ? "bg-green-500" : ""}
            >
              {backend.enabled ? "Enabled" : "Disabled"}
            </Badge>
            {backend.isBackup && (
              <Badge variant="outline" className="bg-orange-500/10 text-orange-500 border-orange-500">
                Backup
              </Badge>
            )}
            <Switch
              checked={backend.enabled}
              onCheckedChange={(checked) => handleToggleEnabled(backend, checked)}
              disabled={updateBackend.isPending}
              className="ml-2"
            />
          </div>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const backend = row.original;

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
              <DropdownMenuItem onClick={() => handleEditClick(backend)}>
                Edit Backend
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => handleDeleteClick(backend)}
              >
                Delete Backend
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={backends}
        isLoading={isLoading}
        searchKey="name"
        searchPlaceholder="Search backends..."
        emptyMessage="No backends configured. Add a backend to start routing traffic."
        showColumnToggle={false}
      />

      <EditBackendDialog
        backend={selectedBackend}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
      />

      <DeleteBackendDialog
        backend={selectedBackend}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      />
    </>
  );
}

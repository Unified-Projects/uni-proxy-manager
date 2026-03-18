"use client";

import { useState } from "react";
import { Calendar, Clock, Shield, AlertTriangle, Wrench } from "lucide-react";
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
  DropdownMenuTrigger,
  Switch,
  useToast,
} from "@uni-proxy-manager/ui";
import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Power, PowerOff, Trash2 } from "lucide-react";
import { useDomains } from "@/hooks/use-domains";
import {
  useMaintenanceWindows,
  useEnableMaintenance,
  useDisableMaintenance,
  useCancelMaintenanceWindow,
} from "@/hooks/use-maintenance";
import type { Domain, MaintenanceWindow } from "@/lib/types";
import { format } from "date-fns";
import { EnableMaintenanceDialog } from "./_components/enable-maintenance-dialog";
import { ScheduleMaintenanceDialog } from "./_components/schedule-maintenance-dialog";
import { BypassIpsDialog } from "./_components/bypass-ips-dialog";
import { CancelMaintenanceDialog } from "./_components/cancel-maintenance-dialog";
import { DomainMaintenanceCard } from "./_components/domain-maintenance-card";

export default function MaintenancePage() {
  const { toast } = useToast();
  const [enableDialogOpen, setEnableDialogOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [bypassIpsDialogOpen, setBypassIpsDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
  const [selectedWindow, setSelectedWindow] = useState<MaintenanceWindow | null>(null);

  const { data: domains, isLoading: domainsLoading } = useDomains();
  const { data: maintenanceWindows, isLoading: windowsLoading } = useMaintenanceWindows();
  const enableMaintenance = useEnableMaintenance();
  const disableMaintenance = useDisableMaintenance();

  const domainsInMaintenance = domains?.filter((d) => d.maintenanceEnabled).length ?? 0;
  const activeWindows = maintenanceWindows?.filter((w) => w.isActive).length ?? 0;
  const scheduledWindows = maintenanceWindows?.filter(
    (w) => !w.isActive && w.scheduledStartAt && new Date(w.scheduledStartAt) > new Date()
  ).length ?? 0;

  const handleEnableClick = (domain: Domain) => {
    setSelectedDomain(domain);
    setEnableDialogOpen(true);
  };

  const handleBypassIpsClick = (domain: Domain) => {
    setSelectedDomain(domain);
    setBypassIpsDialogOpen(true);
  };

  const handleQuickToggle = async (domain: Domain, enabled: boolean) => {
    try {
      if (enabled) {
        await enableMaintenance.mutateAsync({ domainId: domain.id });
        toast({
          title: "Maintenance enabled",
          description: `${domain.hostname} is now in maintenance mode.`,
        });
      } else {
        await disableMaintenance.mutateAsync(domain.id);
        toast({
          title: "Maintenance disabled",
          description: `${domain.hostname} is back online.`,
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update maintenance status",
        variant: "destructive",
      });
    }
  };

  const handleCancelWindow = (window: MaintenanceWindow) => {
    setSelectedWindow(window);
    setCancelDialogOpen(true);
  };

  const domainColumns: ColumnDef<Domain>[] = [
    {
      accessorKey: "hostname",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Domain" />
      ),
      cell: ({ row }) => {
        const domain = row.original;
        return (
          <div className="flex flex-col">
            <span className="font-medium">{domain.hostname}</span>
            {domain.displayName && (
              <span className="text-sm text-muted-foreground">{domain.displayName}</span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "maintenanceEnabled",
      header: "Status",
      cell: ({ row }) => {
        const enabled = row.getValue("maintenanceEnabled") as boolean;
        return (
          <Badge className={enabled ? "bg-yellow-500/10 text-yellow-500" : "bg-green-500/10 text-green-500"}>
            {enabled ? "In Maintenance" : "Online"}
          </Badge>
        );
      },
    },
    {
      accessorKey: "maintenanceBypassIps",
      header: "Bypass IPs",
      cell: ({ row }) => {
        const ips = row.getValue("maintenanceBypassIps") as string[];
        if (!ips || ips.length === 0) {
          return <span className="text-muted-foreground">None</span>;
        }
        return (
          <span className="text-sm">
            {ips.length} IP{ips.length !== 1 ? "s" : ""}
          </span>
        );
      },
    },
    {
      id: "toggle",
      header: "Maintenance",
      cell: ({ row }) => {
        const domain = row.original;
        const isLoading = enableMaintenance.isPending || disableMaintenance.isPending;

        return (
          <Switch
            checked={domain.maintenanceEnabled}
            onCheckedChange={(checked) => handleQuickToggle(domain, checked)}
            disabled={isLoading}
          />
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const domain = row.original;

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
              {domain.maintenanceEnabled ? (
                <DropdownMenuItem onClick={() => handleQuickToggle(domain, false)}>
                  <PowerOff className="mr-2 h-4 w-4" />
                  Disable Maintenance
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => handleEnableClick(domain)}>
                  <Power className="mr-2 h-4 w-4" />
                  Enable with Options
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => handleBypassIpsClick(domain)}>
                <Shield className="mr-2 h-4 w-4" />
                Manage Bypass IPs
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const windowColumns: ColumnDef<MaintenanceWindow>[] = [
    {
      accessorKey: "domain.hostname",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Domain" />
      ),
      cell: ({ row }) => {
        const window = row.original;
        return <span className="font-medium">{window.domain?.hostname ?? "Unknown"}</span>;
      },
    },
    {
      accessorKey: "title",
      header: "Title",
      cell: ({ row }) => {
        const title = row.getValue("title") as string | null;
        return title ?? <span className="text-muted-foreground">Untitled</span>;
      },
    },
    {
      accessorKey: "isActive",
      header: "Status",
      cell: ({ row }) => {
        const window = row.original;
        if (window.isActive) {
          return <Badge className="bg-yellow-500/10 text-yellow-500">Active</Badge>;
        }
        if (window.deactivatedAt) {
          return <Badge className="bg-gray-500/10 text-gray-500">Completed</Badge>;
        }
        if (window.scheduledStartAt && new Date(window.scheduledStartAt) > new Date()) {
          return <Badge className="bg-blue-500/10 text-blue-500">Scheduled</Badge>;
        }
        return <Badge className="bg-gray-500/10 text-gray-500">Inactive</Badge>;
      },
    },
    {
      accessorKey: "scheduledStartAt",
      header: "Scheduled Start",
      cell: ({ row }) => {
        const date = row.getValue("scheduledStartAt") as string | null;
        if (!date) return <span className="text-muted-foreground">Immediate</span>;
        return format(new Date(date), "MMM d, yyyy HH:mm");
      },
    },
    {
      accessorKey: "scheduledEndAt",
      header: "Scheduled End",
      cell: ({ row }) => {
        const date = row.getValue("scheduledEndAt") as string | null;
        if (!date) return <span className="text-muted-foreground">Manual</span>;
        return format(new Date(date), "MMM d, yyyy HH:mm");
      },
    },
    {
      accessorKey: "activatedAt",
      header: "Activated",
      cell: ({ row }) => {
        const date = row.getValue("activatedAt") as string | null;
        if (!date) return <span className="text-muted-foreground">-</span>;
        return format(new Date(date), "MMM d, yyyy HH:mm");
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const window = row.original;
        const canCancel = window.isActive || (window.scheduledStartAt && new Date(window.scheduledStartAt) > new Date());

        if (!canCancel) return null;

        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleCancelWindow(window)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Maintenance</h1>
          <p className="text-muted-foreground">
            Manage maintenance mode and scheduled maintenance windows.
          </p>
        </div>
        <Button onClick={() => setScheduleDialogOpen(true)}>
          <Calendar className="mr-2 h-4 w-4" />
          Schedule Maintenance
        </Button>
      </div>

      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Domains in Maintenance</CardTitle>
            <Wrench className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{domainsInMaintenance}</div>
            <p className="text-xs text-muted-foreground">
              of {domains?.length ?? 0} total domains
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Windows</CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeWindows}</div>
            <p className="text-xs text-muted-foreground">
              maintenance windows currently active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Scheduled Windows</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{scheduledWindows}</div>
            <p className="text-xs text-muted-foreground">
              upcoming maintenance windows
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Domains Grid */}
      <Card>
        <CardHeader>
          <CardTitle>Domain Maintenance Status</CardTitle>
          <CardDescription>
            Toggle maintenance mode for individual domains.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {domainsLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="space-y-3">
                  <div className="aspect-[4/3] w-full bg-muted rounded-md animate-pulse" />
                  <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
                  <div className="h-4 w-1/2 bg-muted rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : domains && domains.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {domains.map((domain) => (
                <DomainMaintenanceCard
                  key={domain.id}
                  domain={domain}
                  onToggleMaintenance={handleQuickToggle}
                  onManageBypassIps={handleBypassIpsClick}
                  isLoading={enableMaintenance.isPending || disableMaintenance.isPending}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border p-12 text-center">
              <Wrench className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No domains found</h3>
              <p className="text-muted-foreground">
                Add domains to manage their maintenance status.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Maintenance Windows Table */}
      <Card>
        <CardHeader>
          <CardTitle>Maintenance Windows</CardTitle>
          <CardDescription>
            History and scheduled maintenance windows.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={windowColumns}
            data={maintenanceWindows ?? []}
            isLoading={windowsLoading}
            searchKey="title"
            searchPlaceholder="Search windows..."
            emptyMessage="No maintenance windows found."
            showColumnToggle={false}
          />
        </CardContent>
      </Card>

      {/* Dialogs */}
      <EnableMaintenanceDialog
        domain={selectedDomain}
        open={enableDialogOpen}
        onOpenChange={setEnableDialogOpen}
      />

      <ScheduleMaintenanceDialog
        open={scheduleDialogOpen}
        onOpenChange={setScheduleDialogOpen}
      />

      <BypassIpsDialog
        domain={selectedDomain}
        open={bypassIpsDialogOpen}
        onOpenChange={setBypassIpsDialogOpen}
      />

      <CancelMaintenanceDialog
        maintenanceWindow={selectedWindow}
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
      />
    </div>
  );
}

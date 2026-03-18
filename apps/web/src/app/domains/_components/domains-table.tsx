"use client";

import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Globe, Shield, Wrench, Server, ChevronDown, ChevronRight, Layers } from "lucide-react";
import Link from "next/link";
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
  cn,
} from "@uni-proxy-manager/ui";
import type { Domain } from "@/lib/types";
import { useState } from "react";
import { DeleteDomainDialog } from "./delete-domain-dialog";
import { getStatusLabel, getStatusColorClass } from "@/lib/domain-status";

/**
 * Extract the root domain from a hostname
 */
function getRootDomain(hostname: string): string {
  if (hostname === "localhost" || /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
    return hostname;
  }

  const parts = hostname.split(".");
  if (parts.length < 2) return hostname;

  const slds = ["co.uk", "co.jp", "co.nz", "co.za", "com.au", "com.br", "org.uk", "ac.uk", "gov.uk"];
  const lastTwo = parts.slice(-2).join(".");
  if (slds.includes(lastTwo)) {
    return parts.slice(-3).join(".");
  }

  return parts.slice(-2).join(".");
}

/**
 * Group domains by their root domain
 */
interface DomainGroupInfo {
  rootDomain: string;
  displayName: string;
  domains: Array<{ hostname: string; displayName: string | null }>;
}

function groupDomainsByRoot<T extends { hostname: string; displayName?: string | null }>(
  domains: T[]
): Map<string, DomainGroupInfo> {
  const groups = new Map<string, DomainGroupInfo>();

  for (const domain of domains) {
    const rootDomain = getRootDomain(domain.hostname);

    if (!groups.has(rootDomain)) {
      const groupDisplayName =
        domain.displayName || rootDomain.charAt(0).toUpperCase() + rootDomain.slice(1);
      groups.set(rootDomain, { rootDomain, displayName: groupDisplayName, domains: [] });
    }

    groups.get(rootDomain)!.domains.push({
      hostname: domain.hostname,
      displayName: domain.displayName || null,
    });
  }

  return groups;
}

interface DomainsTableProps {
  domains: Domain[];
  isLoading: boolean;
}

export function DomainsTable({ domains, isLoading }: DomainsTableProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
  const [groupByDomain, setGroupByDomain] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const handleDeleteClick = (domain: Domain) => {
    setSelectedDomain(domain);
    setDeleteDialogOpen(true);
  };

  // Group domains when grouping is enabled
  const domainGroups = groupByDomain ? groupDomainsByRoot(domains) : new Map<string, DomainGroupInfo>();
  const hasMultipleDomains = domainGroups.size > 1;

  const toggleGroup = (rootDomain: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(rootDomain)) {
        next.delete(rootDomain);
      } else {
        next.add(rootDomain);
      }
      return next;
    });
  };

  const expandAllGroups = () => {
    setExpandedGroups(new Set(domainGroups.keys()));
  };

  const collapseAllGroups = () => {
    setExpandedGroups(new Set());
  };

  const columns: ColumnDef<Domain>[] = [
    {
      accessorKey: "hostname",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Hostname" />
      ),
      cell: ({ row }) => {
        const domain = row.original;
        return (
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <Link
              href={`/domains/${domain.id}`}
              className="font-medium hover:underline"
            >
              {domain.hostname}
            </Link>
          </div>
        );
      },
    },
    {
      accessorKey: "statusComputed",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => {
        const domain = row.original;
        const status = domain.statusComputed || "no-backends";
        return (
          <Badge className={getStatusColorClass(status)}>
            {getStatusLabel(status)}
          </Badge>
        );
      },
    },
    {
      accessorKey: "sslEnabled",
      header: "SSL",
      cell: ({ row }) => {
        const sslEnabled = row.getValue("sslEnabled") as boolean;
        return (
          <div className="flex items-center gap-1">
            <Shield
              className={`h-4 w-4 ${sslEnabled ? "text-green-500" : "text-muted-foreground"}`}
            />
            <span className="text-sm">{sslEnabled ? "Enabled" : "Disabled"}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "maintenanceEnabled",
      header: "Maintenance",
      cell: ({ row }) => {
        const domain = row.original;

        return domain.maintenanceEnabled ? (
          <div className="flex items-center gap-2">
            <Badge className="bg-yellow-500/10 text-yellow-500">
              Active
            </Badge>
            <Wrench className="h-4 w-4 text-yellow-500" />
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Off</span>
        );
      },
    },
    {
      id: "backends",
      header: "Backends",
      cell: ({ row }) => {
        const domain = row.original;
        const totalBackends = domain.backends?.length ?? 0;
        const enabledBackends = domain.backends?.filter(b => b.enabled).length ?? 0;
        return (
          <div className="flex items-center gap-1">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              {enabledBackends} active {totalBackends !== enabledBackends && `/ ${totalBackends} total`}
            </span>
          </div>
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
              <DropdownMenuItem asChild>
                <Link href={`/domains/${domain.id}`}>Configure</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => handleDeleteClick(domain)}
              >
                Delete Domain
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  // Render grouped view
  if (groupByDomain && domainGroups.size > 0) {
    return (
      <>
        {/* Grouping toggle */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Button
              variant={groupByDomain ? "default" : "outline"}
              size="sm"
              onClick={() => setGroupByDomain(!groupByDomain)}
              className="gap-2"
            >
              <Layers className="h-4 w-4" />
              Group by Domain
            </Button>
            {hasMultipleDomains && (
              <div className="flex gap-1 ml-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={expandAllGroups}
                  className="h-7 px-2 text-xs"
                >
                  Expand All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={collapseAllGroups}
                  className="h-7 px-2 text-xs"
                >
                  Collapse All
                </Button>
              </div>
            )}
          </div>
          <span className="text-sm text-muted-foreground">
            {domainGroups.size} group{domainGroups.size !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Grouped domains list */}
        <div className="rounded-md border">
          {Array.from(domainGroups.values()).map((group) => {
            const isExpanded = expandedGroups.has(group.rootDomain);
            const groupDomains = domains.filter(
              (d) => getRootDomain(d.hostname) === group.rootDomain
            );

            return (
              <div key={group.rootDomain} className="border-b last:border-b-0">
                {/* Group header */}
                <div
                  className={cn(
                    "flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/50 transition-colors",
                    isExpanded && "bg-muted/30"
                  )}
                  onClick={() => toggleGroup(group.rootDomain)}
                >
                  {group.domains.length > 1 ? (
                    <>
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </>
                  ) : (
                    <div className="w-4" />
                  )}
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{group.displayName}</span>
                      <Badge variant="outline" className="text-xs">
                        {group.rootDomain}
                      </Badge>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {group.domains.length} domain{group.domains.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>

                {/* Group children */}
                {isExpanded && group.domains.length > 1 && (
                  <div className="bg-muted/20">
                    {groupDomains.map((domain, idx) => (
                      <div
                        key={domain.id}
                        className={cn(
                          "flex items-center gap-4 px-6 py-3 border-t first:border-t-0",
                          idx > 0 && "border-t-dashed"
                        )}
                      >
                        <div className="w-7" />
                        <Globe className="h-4 w-4 text-muted-foreground" />
                        <Link
                          href={`/domains/${domain.id}`}
                          className="font-medium hover:underline flex-1"
                        >
                          {domain.hostname}
                        </Link>
                        <Badge className={getStatusColorClass(domain.statusComputed || "no-backends")}>
                          {getStatusLabel(domain.statusComputed || "no-backends")}
                        </Badge>
                        <div className="flex items-center gap-1">
                          <Shield
                            className={`h-4 w-4 ${domain.sslEnabled ? "text-green-500" : "text-muted-foreground"}`}
                          />
                          <span className="text-sm">{domain.sslEnabled ? "Enabled" : "Disabled"}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Server className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">
                            {domain.backends?.filter(b => b.enabled).length ?? 0} active
                          </span>
                        </div>
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
                              <Link href={`/domains/${domain.id}`}>Configure</Link>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => handleDeleteClick(domain)}
                            >
                              Delete Domain
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <DeleteDomainDialog
          domain={selectedDomain}
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
        />
      </>
    );
  }

  return (
    <>
      {/* Standard view toggle */}
      <div className="flex items-center justify-between mb-4">
        <Button
          variant={groupByDomain ? "outline" : "default"}
          size="sm"
          onClick={() => setGroupByDomain(!groupByDomain)}
          className="gap-2"
        >
          <Layers className="h-4 w-4" />
          Group by Domain
        </Button>
        <span className="text-sm text-muted-foreground">
          {domains.length} domain{domains.length !== 1 ? "s" : ""}
        </span>
      </div>

      <DataTable
        columns={columns}
        data={domains}
        isLoading={isLoading}
        searchKey="hostname"
        searchPlaceholder="Search domains..."
        emptyMessage="No domains found. Add a domain to get started."
      />

      <DeleteDomainDialog
        domain={selectedDomain}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      />
    </>
  );
}

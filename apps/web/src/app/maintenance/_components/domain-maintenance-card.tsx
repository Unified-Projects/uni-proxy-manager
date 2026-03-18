"use client";

import { useState } from "react";
import { Wrench, Shield, Power, PowerOff, MoreVertical, Globe, ExternalLink } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Switch,
} from "@uni-proxy-manager/ui";
import type { Domain } from "@/lib/types";

interface DomainMaintenanceCardProps {
  domain: Domain;
  onToggleMaintenance: (domain: Domain, enabled: boolean) => void;
  onManageBypassIps: (domain: Domain) => void;
  isLoading?: boolean;
}

export function DomainMaintenanceCard({
  domain,
  onToggleMaintenance,
  onManageBypassIps,
  isLoading,
}: DomainMaintenanceCardProps) {
  const [imageError, setImageError] = useState(false);
  const hasMaintenancePage = !!domain.maintenancePageId;

  const getPreviewImageUrl = () => {
    if (domain.maintenancePageId) {
      return `/api/error-pages/${domain.maintenancePageId}/preview.png`;
    }
    return null;
  };

  const previewImageUrl = getPreviewImageUrl();

  // When in maintenance mode, show maintenance page preview
  // When online, show the live site indicator
  const showMaintenancePreview = domain.maintenanceEnabled && hasMaintenancePage;

  return (
    <Card className="overflow-hidden transition-all hover:shadow-lg">
      <CardContent className="p-0">
        {/* Preview Image - context-dependent */}
        <div className="aspect-[4/3] relative overflow-hidden">
          {showMaintenancePreview && previewImageUrl && !imageError ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewImageUrl}
                alt={`${domain.hostname} maintenance page`}
                className="absolute inset-0 w-full h-full object-cover"
                onError={() => setImageError(true)}
              />
              {/* Status Badge */}
              <div className="absolute top-2 right-2">
                <Badge className="bg-yellow-500/10 text-yellow-500 backdrop-blur border-yellow-500">
                  In Maintenance
                </Badge>
              </div>
            </>
          ) : !domain.maintenanceEnabled ? (
            // Site is live - show live indicator with link
            <a
              href={`${domain.sslEnabled ? 'https' : 'http'}://${domain.hostname}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center h-full bg-gradient-to-br from-green-500/10 to-emerald-500/5 hover:from-green-500/20 hover:to-emerald-500/10 transition-colors group"
            >
              <div className="text-center">
                <Globe className="h-12 w-12 mx-auto mb-2 text-green-500" />
                <p className="text-sm text-green-600 font-medium">Site is Live</p>
                <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1 group-hover:text-foreground transition-colors">
                  <span>Visit site</span>
                  <ExternalLink className="h-3 w-3" />
                </p>
              </div>
              {/* Status Badge */}
              <div className="absolute top-2 right-2">
                <Badge className="bg-green-500/10 text-green-500 backdrop-blur border-green-500">
                  Online
                </Badge>
              </div>
            </a>
          ) : (
            // In maintenance but no preview available
            <div className="flex items-center justify-center h-full bg-gradient-to-br from-yellow-500/10 to-yellow-500/5">
              <div className="text-center">
                <Wrench className="h-12 w-12 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {!hasMaintenancePage
                    ? "No maintenance page configured"
                    : imageError
                      ? "Preview unavailable"
                      : "Generating preview..."}
                </p>
              </div>
              {/* Status Badge for placeholder */}
              <div className="absolute top-2 right-2">
                <Badge className="bg-yellow-500/10 text-yellow-500 backdrop-blur border-yellow-500">
                  In Maintenance
                </Badge>
              </div>
            </div>
          )}
        </div>

        {/* Card Info */}
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold truncate">{domain.hostname}</h3>
              {domain.displayName && (
                <p className="text-sm text-muted-foreground truncate">{domain.displayName}</p>
              )}

              {domain.maintenanceBypassIps && domain.maintenanceBypassIps.length > 0 && (
                <div className="flex items-center gap-1 mt-2">
                  <Shield className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {domain.maintenanceBypassIps.length} bypass IP{domain.maintenanceBypassIps.length !== 1 ? "s" : ""}
                  </span>
                </div>
              )}
            </div>

            {/* Actions Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                {domain.maintenanceEnabled ? (
                  <DropdownMenuItem onClick={() => onToggleMaintenance(domain, false)}>
                    <PowerOff className="mr-2 h-4 w-4" />
                    Disable Maintenance
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => onToggleMaintenance(domain, true)}>
                    <Power className="mr-2 h-4 w-4" />
                    Enable Maintenance
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onManageBypassIps(domain)}>
                  <Shield className="mr-2 h-4 w-4" />
                  Manage Bypass IPs
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Quick Toggle */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t">
            <span className="text-sm text-muted-foreground">Quick Toggle</span>
            <Switch
              checked={domain.maintenanceEnabled}
              onCheckedChange={(checked) => onToggleMaintenance(domain, checked)}
              disabled={isLoading}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

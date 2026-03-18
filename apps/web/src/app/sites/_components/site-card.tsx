"use client";

import Link from "next/link";
import Image from "next/image";
import {
  Layers,
  Rocket,
  MoreVertical,
  ExternalLink,
  Trash2,
  Activity,
  AlertCircle,
} from "lucide-react";
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
} from "@uni-proxy-manager/ui";
import type { Site } from "@/lib/types";

const statusColors: Record<string, string> = {
  active: "bg-green-500/10 text-green-500",
  building: "bg-blue-500/10 text-blue-500",
  deploying: "bg-yellow-500/10 text-yellow-500",
  error: "bg-red-500/10 text-red-500",
  disabled: "bg-gray-500/10 text-gray-500",
};

// Health status based on deployments
function getHealthStatus(site: Site): { label: string; color: string } {
  const summary = (site as any).deploymentSummary;

  if (!summary || summary.total === 0) {
    return { label: "No deployments", color: "text-gray-500" };
  }

  if (site.status === "error" || (summary.recentFailed > 0 && site.status !== "active")) {
    return { label: "Unhealthy", color: "text-red-500" };
  }

  if (summary.recentFailed > 0 && site.status === "active") {
    return { label: "Degraded", color: "text-yellow-500" };
  }

  if (site.status === "active" || site.status === "building" || site.status === "deploying") {
    return { label: "Healthy", color: "text-green-500" };
  }

  return { label: site.status, color: "text-gray-500" };
}

const frameworkLabels: Record<string, string> = {
  nextjs: "Next.js",
  sveltekit: "SvelteKit",
  static: "Static",
  custom: "Custom",
};

interface SiteCardProps {
  site: Site;
}

// Check if a preview URL is valid (not a placeholder)
function isValidPreviewUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  // Filter out placeholder URLs
  if (url.includes("via.placeholder.com")) return false;
  if (url.includes("placeholder")) return false;
  return true;
}

export function SiteCard({ site }: SiteCardProps) {
  const latestDeployment = site.latestDeployment;
  const summary = (site as any).deploymentSummary;
  const health = getHealthStatus(site);
  const hasValidPreview = isValidPreviewUrl(latestDeployment?.previewUrl);

  return (
    <Card className="overflow-hidden transition-all hover:shadow-lg">
      <CardContent className="p-0">
        <div className="aspect-[4/3] relative overflow-hidden bg-gradient-to-br from-slate-800 to-slate-900">
          {hasValidPreview ? (
            <Image
              src={latestDeployment!.previewUrl!}
              alt={`Preview of ${site.name}`}
              fill
              className="object-cover"
              unoptimized
              onError={(e) => {
                // Hide broken images
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : null}
          <div className={`absolute inset-0 flex items-center justify-center ${hasValidPreview ? "opacity-0" : ""}`}>
            <Layers className="h-12 w-12 text-slate-700" />
          </div>
          <div className="absolute top-2 right-2 flex items-center gap-2">
            <Badge className={`${statusColors[site.status] || statusColors.disabled} backdrop-blur`}>
              {site.status}
            </Badge>
          </div>
          {site.activeSlot && (
            <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/50 rounded-full px-2 py-1">
              <Activity className="h-3 w-3 text-green-400" />
              <span className="text-xs text-white capitalize">
                {site.activeSlot}
              </span>
            </div>
          )}
          {summary && summary.total > 0 && (
            <div className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-black/50 rounded-full px-2 py-1">
              <Rocket className="h-3 w-3 text-white" />
              <span className="text-xs text-white">
                {summary.total} deploy{summary.total !== 1 ? "s" : ""}
              </span>
              {summary.recentFailed > 0 && (
                <span className="text-xs text-red-400 flex items-center gap-0.5">
                  <AlertCircle className="h-3 w-3" />
                  {summary.recentFailed}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <Link
                href={`/sites/${site.id}`}
                className="font-semibold hover:underline truncate block"
              >
                {site.name}
              </Link>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-xs ${health.color}`}>{health.label}</span>
                {latestDeployment?.deployedAt && (
                  <span className="text-xs text-muted-foreground">
                    - {new Date(latestDeployment.deployedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href={`/sites/${site.id}`}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    View Details
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/sites/${site.id}?tab=deployments`}>
                    <Rocket className="mr-2 h-4 w-4" />
                    Deployments
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

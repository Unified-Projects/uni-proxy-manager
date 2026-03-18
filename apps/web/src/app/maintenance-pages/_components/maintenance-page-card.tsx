"use client";

import { useState } from "react";
import { Wrench, Upload, MoreVertical, Trash2, Download, RefreshCw, Loader2 } from "lucide-react";
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
  useToast,
} from "@uni-proxy-manager/ui";
import { useRegenerateMaintenancePagePreview } from "@/hooks/use-maintenance-pages";
import type { ErrorPage } from "@/lib/types";

interface MaintenancePageCardProps {
  maintenancePage: ErrorPage;
  onUpload: (page: ErrorPage) => void;
  onDelete: (page: ErrorPage) => void;
}

export function MaintenancePageCard({
  maintenancePage,
  onUpload,
  onDelete,
}: MaintenancePageCardProps) {
  const { toast } = useToast();
  const [imageError, setImageError] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [imageKey, setImageKey] = useState(Date.now());
  const regeneratePreview = useRegenerateMaintenancePagePreview();

  const hasUpload = !!maintenancePage.uploadedAt;

  const getPreviewImageUrl = () => {
    // Show preview URL if files are uploaded - API generates preview on demand
    if (hasUpload) {
      return `/api/error-pages/${maintenancePage.id}/preview.png?t=${imageKey}`;
    }
    return null;
  };

  const handleDownload = () => {
    window.open(`/api/error-pages/${maintenancePage.id}/download`, "_blank");
  };

  const handleRegeneratePreview = async () => {
    setIsRegenerating(true);
    setImageError(false);
    try {
      await regeneratePreview.mutateAsync(maintenancePage.id);
      toast({
        title: "Preview regenerated",
        description: "The preview image has been regenerated.",
      });
      // Force reload the image with new cache key
      setImageKey(Date.now());
      setIsRegenerating(false);
    } catch (error) {
      toast({
        title: "Failed to regenerate preview",
        description:
          error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
      setIsRegenerating(false);
    }
  };

  const previewImageUrl = getPreviewImageUrl();

  return (
    <Card className="overflow-hidden transition-all hover:shadow-lg">
      <CardContent className="p-0">
        {/* Preview Image - always visible */}
        <div className="aspect-[4/3] relative overflow-hidden bg-gradient-to-br from-yellow-500/10 to-orange-500/5">
          {previewImageUrl && !imageError && !isRegenerating ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewImageUrl}
                alt={maintenancePage.name}
                className="absolute inset-0 w-full h-full object-cover"
                onError={() => setImageError(true)}
              />
              {/* Overlay badge */}
              <div className="absolute top-2 right-2">
                <Badge className="bg-yellow-500/10 text-yellow-500 backdrop-blur border-yellow-500">
                  Maintenance
                </Badge>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                {isRegenerating ? (
                  <>
                    <Loader2 className="h-12 w-12 mx-auto mb-2 text-yellow-500 animate-spin" />
                    <p className="text-sm text-muted-foreground">
                      Generating preview...
                    </p>
                  </>
                ) : (
                  <>
                    <Wrench className="h-12 w-12 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {!hasUpload
                        ? "No files uploaded"
                        : imageError
                          ? "Preview unavailable"
                          : "Generating preview..."}
                    </p>
                    {imageError && hasUpload && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={handleRegeneratePreview}
                      >
                        <RefreshCw className="mr-2 h-3 w-3" />
                        Retry
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Info section */}
        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold truncate">{maintenancePage.name}</h3>
              {maintenancePage.description && (
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                  {maintenancePage.description}
                </p>
              )}
              {maintenancePage.uploadedAt && (
                <p className="text-xs text-muted-foreground mt-2">
                  Uploaded{" "}
                  {new Date(maintenancePage.uploadedAt).toLocaleDateString()}
                </p>
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
                <DropdownMenuItem onClick={() => onUpload(maintenancePage)}>
                  <Upload className="mr-2 h-4 w-4" />
                  {hasUpload ? "Replace" : "Upload"} Files
                </DropdownMenuItem>
                {hasUpload && (
                  <>
                    <DropdownMenuItem onClick={handleDownload}>
                      <Download className="mr-2 h-4 w-4" />
                      Download Source
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleRegeneratePreview}>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Regenerate Preview
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDelete(maintenancePage)}
                >
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

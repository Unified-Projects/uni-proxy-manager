"use client";

import { useState } from "react";
import { FileWarning, Upload, MoreVertical, Trash2, Download, RefreshCw, Loader2 } from "lucide-react";
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
import type { ErrorPage } from "@/lib/types";

const typeColors: Record<string, string> = {
  "503": "bg-red-500/10 text-red-500",
  "404": "bg-orange-500/10 text-orange-500",
  "500": "bg-red-500/10 text-red-500",
  "502": "bg-red-500/10 text-red-500",
  "504": "bg-red-500/10 text-red-500",
  custom: "bg-blue-500/10 text-blue-500",
};

interface ErrorPageCardProps {
  errorPage: ErrorPage;
  onUpload: (errorPage: ErrorPage) => void;
  onDelete: (errorPage: ErrorPage) => void;
}

export function ErrorPageCard({
  errorPage,
  onUpload,
  onDelete,
}: ErrorPageCardProps) {
  const { toast } = useToast();
  const [imageError, setImageError] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [imageKey, setImageKey] = useState(Date.now());
  const hasUpload = !!errorPage.uploadedAt;

  const getPreviewImageUrl = () => {
    // Show preview URL if files are uploaded - API generates preview on demand
    if (hasUpload) {
      return `/api/error-pages/${errorPage.id}/preview.png?t=${imageKey}`;
    }
    return null;
  };

  const handleDownload = () => {
    window.open(`/api/error-pages/${errorPage.id}/download`, "_blank");
  };

  const handleRegeneratePreview = async () => {
    setIsRegenerating(true);
    setImageError(false);
    try {
      const response = await fetch(
        `/api/error-pages/${errorPage.id}/regenerate-preview`,
        { method: "POST" }
      );
      if (!response.ok) throw new Error("Failed to regenerate preview");
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
        <div className="aspect-[4/3] relative overflow-hidden">
          {previewImageUrl && !imageError && !isRegenerating ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewImageUrl}
                alt={errorPage.name}
                className="absolute inset-0 w-full h-full object-cover"
                onError={() => setImageError(true)}
              />
              {/* Type Badge */}
              <div className="absolute top-2 right-2">
                <Badge className={`${typeColors[errorPage.type]} backdrop-blur`}>
                  {errorPage.type === "custom" && errorPage.httpStatusCode
                    ? `${errorPage.httpStatusCode}`
                    : errorPage.type}
                </Badge>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full bg-gradient-to-br from-muted to-muted/50">
              <div className="text-center">
                {isRegenerating ? (
                  <>
                    <Loader2 className="h-12 w-12 mx-auto mb-2 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">
                      Generating preview...
                    </p>
                  </>
                ) : (
                  <>
                    <FileWarning className="h-12 w-12 mx-auto mb-2 text-muted-foreground" />
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
              <h3 className="font-semibold truncate">{errorPage.name}</h3>
              {errorPage.description && (
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                  {errorPage.description}
                </p>
              )}
              {!previewImageUrl && (
                <div className="flex items-center gap-2 mt-2">
                  <Badge className={typeColors[errorPage.type]}>
                    {errorPage.type === "custom" && errorPage.httpStatusCode
                      ? `${errorPage.httpStatusCode}`
                      : errorPage.type}
                  </Badge>
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
                <DropdownMenuItem onClick={() => onUpload(errorPage)}>
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
                  onClick={() => onDelete(errorPage)}
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

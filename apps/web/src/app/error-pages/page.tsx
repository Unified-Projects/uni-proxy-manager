"use client";

import { useState } from "react";
import { Plus, FileWarning } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@uni-proxy-manager/ui";
import { useErrorPages } from "@/hooks/use-error-pages";
import type { ErrorPage } from "@/lib/types";
import { CreateErrorPageDialog } from "./_components/create-error-page-dialog";
import { UploadErrorPageDialog } from "./_components/upload-error-page-dialog";
import { DeleteErrorPageDialog } from "./_components/delete-error-page-dialog";
import { ErrorPageCard } from "./_components/error-page-card";

export default function ErrorPagesPage() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedErrorPage, setSelectedErrorPage] = useState<ErrorPage | null>(null);

  const { data: errorPages, isLoading } = useErrorPages();

  const handleUploadClick = (errorPage: ErrorPage) => {
    setSelectedErrorPage(errorPage);
    setUploadDialogOpen(true);
  };

  const handleDeleteClick = (errorPage: ErrorPage) => {
    setSelectedErrorPage(errorPage);
    setDeleteDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Error Pages</h1>
          <p className="text-muted-foreground">
            Custom error and maintenance pages for your domains.
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Error Page
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Error Pages</CardTitle>
          <CardDescription>
            {errorPages?.length ?? 0} error page{(errorPages?.length ?? 0) !== 1 ? "s" : ""} configured
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="space-y-3">
                  <Skeleton className="aspect-[4/3] w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))}
            </div>
          ) : errorPages && errorPages.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {errorPages.map((errorPage) => (
                <ErrorPageCard
                  key={errorPage.id}
                  errorPage={errorPage}
                  onUpload={handleUploadClick}
                  onDelete={handleDeleteClick}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border p-12 text-center">
              <FileWarning className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No error pages found</h3>
              <p className="text-muted-foreground mb-4">
                Create one to get started with custom error and maintenance pages.
              </p>
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Error Page
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateErrorPageDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />

      <UploadErrorPageDialog
        errorPage={selectedErrorPage}
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
      />

      <DeleteErrorPageDialog
        errorPage={selectedErrorPage}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      />
    </div>
  );
}

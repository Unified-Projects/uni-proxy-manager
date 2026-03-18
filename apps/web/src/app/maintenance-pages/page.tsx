"use client";

import { useState } from "react";
import { Plus, Wrench } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@uni-proxy-manager/ui";
import { useMaintenancePages } from "@/hooks/use-maintenance-pages";
import type { ErrorPage } from "@/lib/types";
import { CreateMaintenancePageDialog } from "./_components/create-maintenance-page-dialog";
import { UploadMaintenancePageDialog } from "./_components/upload-maintenance-page-dialog";
import { DeleteMaintenancePageDialog } from "./_components/delete-maintenance-page-dialog";
import { MaintenancePageCard } from "./_components/maintenance-page-card";

export default function MaintenancePagesPage() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPage, setSelectedPage] = useState<ErrorPage | null>(null);

  const { data: maintenancePages, isLoading } = useMaintenancePages();

  const handleUploadClick = (page: ErrorPage) => {
    setSelectedPage(page);
    setUploadDialogOpen(true);
  };

  const handleDeleteClick = (page: ErrorPage) => {
    setSelectedPage(page);
    setDeleteDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Maintenance Pages</h1>
          <p className="text-muted-foreground">
            Custom maintenance pages displayed during scheduled maintenance windows.
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Maintenance Page
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Maintenance Pages</CardTitle>
          <CardDescription>
            {maintenancePages?.length ?? 0} maintenance page
            {(maintenancePages?.length ?? 0) !== 1 ? "s" : ""} configured
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
          ) : maintenancePages && maintenancePages.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {maintenancePages.map((page) => (
                <MaintenancePageCard
                  key={page.id}
                  maintenancePage={page}
                  onUpload={handleUploadClick}
                  onDelete={handleDeleteClick}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border p-12 text-center">
              <Wrench className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No maintenance pages found</h3>
              <p className="text-muted-foreground mb-4">
                Create a maintenance page to display during scheduled maintenance windows.
              </p>
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Maintenance Page
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateMaintenancePageDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />

      <UploadMaintenancePageDialog
        maintenancePage={selectedPage}
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
      />

      <DeleteMaintenancePageDialog
        maintenancePage={selectedPage}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      />
    </div>
  );
}

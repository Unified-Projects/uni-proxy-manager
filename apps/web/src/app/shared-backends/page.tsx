"use client";

import { useState } from "react";
import { Plus, Share2 } from "lucide-react";
import { Button } from "@uni-proxy-manager/ui";
import { useSharedBackends } from "@/hooks/use-shared-backends";
import { SharedBackendsTable } from "./_components/shared-backends-table";
import { CreateSharedBackendDialog } from "./_components/create-shared-backend-dialog";

export default function SharedBackendsPage() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const { data: sharedBackends, isLoading } = useSharedBackends();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Shared Backends</h1>
          <p className="text-muted-foreground">
            Define backend servers once and reuse them across multiple domains.
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Shared Backend
        </Button>
      </div>

      <SharedBackendsTable
        sharedBackends={sharedBackends ?? []}
        isLoading={isLoading}
      />

      <CreateSharedBackendDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
    </div>
  );
}

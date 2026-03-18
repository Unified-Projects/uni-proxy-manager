"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@uni-proxy-manager/ui";
import { useDomains } from "@/hooks/use-domains";
import { DomainsTable } from "./_components/domains-table";
import { CreateDomainDialog } from "./_components/create-domain-dialog";

export default function DomainsPage() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const { data: domains, isLoading } = useDomains();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Domains</h1>
          <p className="text-muted-foreground">
            Manage your domains and their backend configurations.
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Domain
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Domains</CardTitle>
          <CardDescription>
            {domains?.length ?? 0} domain{(domains?.length ?? 0) !== 1 ? "s" : ""} configured
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DomainsTable domains={domains ?? []} isLoading={isLoading} />
        </CardContent>
      </Card>

      <CreateDomainDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </div>
  );
}

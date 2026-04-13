"use client";

import { useState } from "react";
import { Plus, MoreVertical, Trash2, Edit, TestTube, Star } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Skeleton,
} from "@uni-proxy-manager/ui";
import { usePomeriumIdps, useTestPomeriumIdp } from "@/hooks";
import type { PomeriumIdentityProvider } from "@/lib/types";
import { CreateIdpDialog } from "./create-idp-dialog";
import { EditIdpDialog } from "./edit-idp-dialog";
import { DeleteIdpDialog } from "./delete-idp-dialog";

const idpTypeLabels: Record<string, string> = {
  google: "Google Workspace",
  azure: "Microsoft Entra ID",
  github: "GitHub",
  oidc: "Generic OIDC",
};

const idpTypeColors: Record<string, string> = {
  google: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  azure: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  github: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  oidc: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

export function IdentityProvidersTab() {
  const { data: idps, isLoading } = usePomeriumIdps();
  const [createOpen, setCreateOpen] = useState(false);
  const [editIdp, setEditIdp] = useState<PomeriumIdentityProvider | null>(null);
  const [deleteIdp, setDeleteIdp] = useState<PomeriumIdentityProvider | null>(
    null,
  );

  const testIdp = useTestPomeriumIdp();
  const hasConfiguredProvider = (idps?.length ?? 0) >= 1;

  const handleTest = async (idp: PomeriumIdentityProvider) => {
    await testIdp.mutateAsync(idp.id);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Identity Providers</CardTitle>
            <CardDescription>
              Configure authentication providers for user sign-in. Pomerium
              currently supports one OAuth provider at a time.
            </CardDescription>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            disabled={hasConfiguredProvider}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Provider
          </Button>
        </CardHeader>
        <CardContent>
          <Alert className="mb-4">
            <AlertTitle>Single provider limit</AlertTitle>
            <AlertDescription>
              Only one OAuth provider can be configured for Pomerium right now.
              Edit or delete the existing provider to switch authentication.
            </AlertDescription>
          </Alert>

          {idps && idps.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Validated</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {idps.map((idp) => (
                  <TableRow key={idp.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {idp.displayName || idp.name}
                        {idp.isDefault && (
                          <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={idpTypeColors[idp.type]}
                      >
                        {idpTypeLabels[idp.type] || idp.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {idp.enabled ? (
                        <Badge variant="default" className="bg-green-600">
                          Enabled
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Disabled</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {idp.lastValidated
                        ? new Date(idp.lastValidated).toLocaleDateString()
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditIdp(idp)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleTest(idp)}>
                            <TestTube className="h-4 w-4 mr-2" />
                            Test Connection
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeleteIdp(idp)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <p>No identity providers configured.</p>
              <p className="text-sm mt-1">
                Add an identity provider to enable user authentication.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateIdpDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        maxProvidersReached={hasConfiguredProvider}
      />

      {editIdp && (
        <EditIdpDialog
          idp={editIdp}
          open={!!editIdp}
          onOpenChange={(open) => !open && setEditIdp(null)}
        />
      )}

      {deleteIdp && (
        <DeleteIdpDialog
          idp={deleteIdp}
          open={!!deleteIdp}
          onOpenChange={(open) => !open && setDeleteIdp(null)}
        />
      )}
    </>
  );
}

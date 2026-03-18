"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Layers,
  Rocket,
  Settings2,
  BarChart3,
  Pencil,
  Trash2,
  RotateCcw,
  Github,
  Activity,
  Clock,
  Cpu,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Skeleton,
  useToast,
} from "@uni-proxy-manager/ui";
import {
  useSite,
  useDeploySite,
  useUploadDeploySite,
  useDeployments,
  useGitHubConnection,
} from "@/hooks";
import { DeploymentList } from "./_components/deployment-list";
import { SiteSettings } from "./_components/site-settings";
import { SiteAnalytics } from "./_components/site-analytics";
import { GitHubSettings } from "./_components/github-settings";
import { EditSiteDialog } from "./_components/edit-site-dialog";
import { DeleteSiteDialog } from "./_components/delete-site-dialog";
import { RollbackDialog } from "./_components/rollback-dialog";
import { DeployDialog } from "./_components/deploy-dialog";

const statusColors: Record<string, string> = {
  active: "bg-green-500/10 text-green-500",
  building: "bg-blue-500/10 text-blue-500",
  deploying: "bg-yellow-500/10 text-yellow-500",
  error: "bg-red-500/10 text-red-500",
  disabled: "bg-gray-500/10 text-gray-500",
};

const frameworkLabels: Record<string, string> = {
  nextjs: "Next.js",
  sveltekit: "SvelteKit",
  static: "Static",
  custom: "Custom",
};

interface SiteDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function SiteDetailPage({ params }: SiteDetailPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState(false);
  const [deployDialogOpen, setDeployDialogOpen] = useState(false);

  const { data: site, isLoading } = useSite(id);
  const { data: deployments } = useDeployments(id);
  const { data: githubConnection } = useGitHubConnection(id);
  const deploySite = useDeploySite();
  const uploadDeploySite = useUploadDeploySite();

  const handleDeployGitHub = async () => {
    if (!site) return;

    try {
      await deploySite.mutateAsync(site.id);
      toast({
        title: "Deployment started",
        description: `A new deployment has been triggered for ${site.name}.`,
      });
    } catch (error) {
      toast({
        title: "Deployment failed",
        description:
          error instanceof Error ? error.message : "Failed to start deployment",
        variant: "destructive",
      });
    }
  };

  const handleDeployUpload = async (file: File) => {
    if (!site) return;

    try {
      await uploadDeploySite.mutateAsync({ id: site.id, file });
      toast({
        title: "Upload deployment started",
        description: `Deploying ${file.name} to ${site.name}.`,
      });
    } catch (error) {
      toast({
        title: "Upload failed",
        description:
          error instanceof Error ? error.message : "Failed to upload and deploy",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  if (!site) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <h2 className="text-2xl font-bold">Site not found</h2>
        <p className="text-muted-foreground">
          The site you&apos;re looking for doesn&apos;t exist.
        </p>
        <Button asChild className="mt-4">
          <Link href="/sites">Back to Sites</Link>
        </Button>
      </div>
    );
  }

  const latestDeployment = site.latestDeployment;
  const isDeploying =
    site.status === "building" || site.status === "deploying";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/sites">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <Layers className="h-6 w-6" />
              <h1 className="text-3xl font-bold">{site.name}</h1>
              <Badge className={statusColors[site.status] || statusColors.disabled}>
                {site.status}
              </Badge>
            </div>
            <div className="flex items-center gap-2 mt-1 text-muted-foreground">
              <span>{frameworkLabels[site.framework] || site.framework}</span>
              <span>-</span>
              <span>{site.slug}</span>
              {githubConnection?.connection ? (
                <>
                  <span>-</span>
                  <Github className="h-3 w-3" />
                  <span>{githubConnection.connection.repositoryFullName}</span>
                </>
              ) : (
                <>
                  <span>-</span>
                  <span className="text-muted-foreground">Manual Deployment</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setDeployDialogOpen(true)}
            disabled={isDeploying || deploySite.isPending || uploadDeploySite.isPending}
          >
            <Rocket className="mr-2 h-4 w-4" />
            {isDeploying ? "Deploying..." : "Deploy"}
          </Button>
          {latestDeployment && (
            <Button
              variant="outline"
              onClick={() => setRollbackDialogOpen(true)}
              disabled={isDeploying}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Rollback
            </Button>
          )}
          <Button variant="outline" onClick={() => setEditDialogOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button
            variant="destructive"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Slot</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">
              {site.activeSlot || "None"}
            </div>
            {site.activeVersion && (
              <p className="text-xs text-muted-foreground">
                Version {site.activeVersion}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Deployments</CardTitle>
            <Rocket className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{deployments?.length ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              {deployments?.filter((d) => d.status === "live").length ?? 0} live
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Resources</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{site.memoryMb}MB</div>
            <p className="text-xs text-muted-foreground">
              CPU: {site.cpuLimit} | Timeout: {site.timeoutSeconds}s
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Last Deploy</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {latestDeployment ? (
              <>
                <div className="text-2xl font-bold">
                  {latestDeployment.buildDurationMs
                    ? `${Math.round(latestDeployment.buildDurationMs / 1000)}s`
                    : "-"}
                </div>
                <p className="text-xs text-muted-foreground">
                  {latestDeployment.deployedAt
                    ? new Date(latestDeployment.deployedAt).toLocaleDateString()
                    : "In progress"}
                </p>
              </>
            ) : (
              <div className="text-2xl font-bold">-</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="deployments" className="space-y-4">
        <TabsList>
          <TabsTrigger value="deployments">
            <Rocket className="mr-2 h-4 w-4" />
            Deployments
          </TabsTrigger>
          <TabsTrigger value="analytics">
            <BarChart3 className="mr-2 h-4 w-4" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="github">
            <Github className="mr-2 h-4 w-4" />
            GitHub
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings2 className="mr-2 h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="deployments" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Deployment History</CardTitle>
              <CardDescription>
                View and manage your site deployments
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DeploymentList siteId={site.id} deployments={deployments ?? []} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <SiteAnalytics siteId={site.id} />
        </TabsContent>

        <TabsContent value="github" className="space-y-4">
          <GitHubSettings siteId={site.id} connection={githubConnection?.connection} />
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <SiteSettings site={site} />
        </TabsContent>
      </Tabs>

      <EditSiteDialog
        site={site}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
      />

      <DeleteSiteDialog
        site={site}
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) {
            router.push("/sites");
          }
        }}
      />

      <RollbackDialog
        site={site}
        deployments={deployments ?? []}
        open={rollbackDialogOpen}
        onOpenChange={setRollbackDialogOpen}
      />

      <DeployDialog
        site={site}
        githubConnection={githubConnection?.connection}
        open={deployDialogOpen}
        onOpenChange={setDeployDialogOpen}
        onDeployGitHub={handleDeployGitHub}
        onDeployUpload={handleDeployUpload}
        isDeploying={deploySite.isPending || uploadDeploySite.isPending}
      />
    </div>
  );
}

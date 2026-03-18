"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "@uni-proxy-manager/ui";
import { useCreateSite } from "@/hooks";
import type { SiteFramework, SiteRenderMode } from "@/lib/types";

interface CreateSiteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateSiteDialog({
  open,
  onOpenChange,
}: CreateSiteDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const createSite = useCreateSite();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [framework, setFramework] = useState<SiteFramework>("nextjs");
  const [renderMode, setRenderMode] = useState<SiteRenderMode>("ssr");
  const [buildCommand, setBuildCommand] = useState("");
  const [installCommand, setInstallCommand] = useState("");
  const [outputDirectory, setOutputDirectory] = useState("");

  const getDefaultCommands = (fw: SiteFramework) => {
    switch (fw) {
      case "nextjs":
        return {
          build: "npm run build",
          install: "npm install",
          output: ".next",
        };
      case "sveltekit":
        return {
          build: "npm run build",
          install: "npm install",
          output: "build",
        };
      case "static":
        return {
          build: "",
          install: "",
          output: "public",
        };
      default:
        return {
          build: "npm run build",
          install: "npm install",
          output: "dist",
        };
    }
  };

  const handleFrameworkChange = (value: SiteFramework) => {
    setFramework(value);
    const defaults = getDefaultCommands(value);
    if (!buildCommand) setBuildCommand(defaults.build);
    if (!installCommand) setInstallCommand(defaults.install);
    if (!outputDirectory) setOutputDirectory(defaults.output);
  };

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slug) {
      setSlug(
        value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const result = await createSite.mutateAsync({
        name,
        slug,
        framework,
        renderMode,
        buildCommand: buildCommand || undefined,
        installCommand: installCommand || undefined,
        outputDirectory: outputDirectory || undefined,
      });

      toast({
        title: "Site created",
        description: `${result.site.name} has been created successfully.`,
      });

      onOpenChange(false);
      router.push(`/sites/${result.site.id}`);
    } catch (error) {
      toast({
        title: "Failed to create site",
        description:
          error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setName("");
      setSlug("");
      setFramework("nextjs");
      setRenderMode("ssr");
      setBuildCommand("");
      setInstallCommand("");
      setOutputDirectory("");
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Site</DialogTitle>
            <DialogDescription>
              Create a new site to deploy your web application.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="My Awesome Site"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="my-awesome-site"
                pattern="[a-z0-9-]+"
                required
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens only
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="framework">Framework</Label>
                <Select
                  value={framework}
                  onValueChange={handleFrameworkChange}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nextjs">Next.js</SelectItem>
                    <SelectItem value="sveltekit">SvelteKit</SelectItem>
                    <SelectItem value="static">Static</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="renderMode">Render Mode</Label>
                <Select
                  value={renderMode}
                  onValueChange={(value) => setRenderMode(value as SiteRenderMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ssr">SSR</SelectItem>
                    <SelectItem value="ssg">SSG</SelectItem>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="installCommand">Install Command</Label>
              <Input
                id="installCommand"
                value={installCommand}
                onChange={(e) => setInstallCommand(e.target.value)}
                placeholder="npm install"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="buildCommand">Build Command</Label>
              <Input
                id="buildCommand"
                value={buildCommand}
                onChange={(e) => setBuildCommand(e.target.value)}
                placeholder="npm run build"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="outputDirectory">Output Directory</Label>
              <Input
                id="outputDirectory"
                value={outputDirectory}
                onChange={(e) => setOutputDirectory(e.target.value)}
                placeholder=".next"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createSite.isPending}>
              {createSite.isPending ? "Creating..." : "Create Site"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { Shield, BarChart3, Info, AlertTriangle, Bug } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Switch,
  Label,
  useToast,
  Alert,
  AlertDescription,
  Skeleton,
} from "@uni-proxy-manager/ui";
import { useDomain, useUpdateDomain } from "@/hooks/use-domains";

interface DomainBotProtectionProps {
  domainId: string;
}

export function DomainBotProtection({ domainId }: DomainBotProtectionProps) {
  const { toast } = useToast();
  const { data: domain, isLoading } = useDomain(domainId);
  const updateDomain = useUpdateDomain();

  const [filterBotsFromStats, setFilterBotsFromStats] = useState(domain?.filterBotsFromStats ?? true);
  const [blockBots, setBlockBots] = useState(domain?.blockBots ?? false);

  // Sync local state with domain data
  useState(() => {
    if (domain) {
      setFilterBotsFromStats(domain.filterBotsFromStats ?? true);
      setBlockBots(domain.blockBots ?? false);
    }
  });

  const hasChanges =
    filterBotsFromStats !== (domain?.filterBotsFromStats ?? true) ||
    blockBots !== (domain?.blockBots ?? false);

  const handleSave = async () => {
    if (!domain) return;

    try {
      await updateDomain.mutateAsync({
        id: domain.id,
        data: {
          filterBotsFromStats,
          blockBots,
        },
      });

      toast({
        title: "Bot protection updated",
        description: "Settings have been saved successfully.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update bot protection",
        variant: "destructive",
      });

      // Revert on error
      if (domain) {
        setFilterBotsFromStats(domain.filterBotsFromStats ?? true);
        setBlockBots(domain.blockBots ?? false);
      }
    }
  };

  const handleReset = () => {
    if (domain) {
      setFilterBotsFromStats(domain.filterBotsFromStats ?? true);
      setBlockBots(domain.blockBots ?? false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-96" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32" />
        </CardContent>
      </Card>
    );
  }

  if (!domain) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bug className="h-5 w-5" />
          <CardTitle>Bot Detection & Protection</CardTitle>
        </div>
        <CardDescription>
          Configure how bot traffic is handled for this domain
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Filter Bots from Statistics */}
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex-1">
              <Label htmlFor="filter-bots" className="flex items-center gap-2 text-base font-medium cursor-pointer">
                <BarChart3 className="h-4 w-4" />
                Filter bots from statistics
              </Label>
              <p className="text-sm text-muted-foreground mt-1">
                Exclude bot traffic from analytics and visitor counts
              </p>
            </div>
            <Switch
              id="filter-bots"
              checked={filterBotsFromStats}
              onCheckedChange={setFilterBotsFromStats}
              disabled={updateDomain.isPending}
            />
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <strong>Recommended: Enabled.</strong> Bots can still access your site, but won't inflate your statistics.
              This provides accurate analytics while allowing search engines to crawl your content.
            </AlertDescription>
          </Alert>
        </div>

        {/* Block Bots at Proxy Level */}
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex-1">
              <Label htmlFor="block-bots" className="flex items-center gap-2 text-base font-medium cursor-pointer">
                <Shield className="h-4 w-4" />
                Block bots at proxy level
              </Label>
              <p className="text-sm text-muted-foreground mt-1">
                Deny bot requests with 403 status before reaching your backend
              </p>
            </div>
            <Switch
              id="block-bots"
              checked={blockBots}
              onCheckedChange={setBlockBots}
              disabled={updateDomain.isPending}
            />
          </div>

          {blockBots && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Warning:</strong> Blocking bots will prevent search engines from crawling your site,
                which may negatively impact SEO. Only enable this for internal tools, APIs, or during bot attacks.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Current Configuration Badge */}
        <div className="rounded-lg border p-4 space-y-2">
          <h4 className="text-sm font-medium">Current Configuration</h4>
          <div className="flex flex-wrap gap-2">
            {filterBotsFromStats && (
              <Badge variant="default" className="bg-green-500">
                <BarChart3 className="h-3 w-3 mr-1" />
                Filtering from Stats
              </Badge>
            )}
            {blockBots && (
              <Badge variant="destructive">
                <Shield className="h-3 w-3 mr-1" />
                Blocking at Proxy
              </Badge>
            )}
            {!filterBotsFromStats && !blockBots && (
              <Badge variant="secondary">
                <Info className="h-3 w-3 mr-1" />
                No Bot Protection
              </Badge>
            )}
          </div>
        </div>

        {/* Detected Bot Types Info */}
        <div className="rounded-lg border p-4 space-y-2">
          <h4 className="text-sm font-medium">Detected Bot Types</h4>
          <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
            <div>• Search engines (Google, Bing, Yahoo)</div>
            <div>• Social media (Facebook, Twitter, LinkedIn)</div>
            <div>• SEO tools (Ahrefs, SEMrush, Moz)</div>
            <div>• Monitoring (UptimeRobot, Pingdom)</div>
            <div>• Security scanners (Shodan, Nessus)</div>
            <div>• AI crawlers (GPT, Claude, Perplexity)</div>
            <div>• HTTP clients (curl, wget, requests)</div>
            <div>• Headless browsers (Puppeteer, Selenium)</div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            100+ bot patterns are automatically detected
          </p>
        </div>

        {/* Save/Cancel Buttons */}
        {hasChanges && (
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={updateDomain.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={updateDomain.isPending}>
              {updateDomain.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

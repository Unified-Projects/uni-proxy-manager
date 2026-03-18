/**
 * Example bot filtering settings component for domain settings UI.
 * Drop this into apps/web/src/app/domains/[id]/_components/bot-settings.tsx
 */

import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, Shield, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BotSettingsProps {
  domainId: string;
  blockBots: boolean;
  filterBotsFromStats: boolean;
  onUpdate: (settings: { blockBots: boolean; filterBotsFromStats: boolean }) => Promise<void>;
}

export function BotSettings({ domainId, blockBots, filterBotsFromStats, onUpdate }: BotSettingsProps) {
  const [isBlockBots, setIsBlockBots] = useState(blockBots);
  const [isFilterBots, setIsFilterBots] = useState(filterBotsFromStats);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      await onUpdate({
        blockBots: isBlockBots,
        filterBotsFromStats: isFilterBots,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update bot settings");
      // Revert on error
      setIsBlockBots(blockBots);
      setIsFilterBots(filterBotsFromStats);
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges = isBlockBots !== blockBots || isFilterBots !== filterBotsFromStats;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Bot Protection
        </CardTitle>
        <CardDescription>
          Configure how bot traffic is handled for this domain
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Filter Bots from Statistics */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1 flex-1">
              <Label htmlFor="filter-bots" className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Filter bots from statistics
              </Label>
              <p className="text-sm text-muted-foreground">
                Exclude bot traffic from analytics and visitor counts
              </p>
            </div>
            <Switch
              id="filter-bots"
              checked={isFilterBots}
              onCheckedChange={setIsFilterBots}
              disabled={isSaving}
            />
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <strong>Recommended:</strong> Enabled. Bots can still access your site, but won't inflate your statistics.
              This provides accurate analytics while allowing search engines to crawl your content.
            </AlertDescription>
          </Alert>
        </div>

        {/* Block Bots at Proxy Level */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1 flex-1">
              <Label htmlFor="block-bots" className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Block bots at proxy level
              </Label>
              <p className="text-sm text-muted-foreground">
                Deny bot requests with 403 status before reaching your backend
              </p>
            </div>
            <Switch
              id="block-bots"
              checked={isBlockBots}
              onCheckedChange={setIsBlockBots}
              disabled={isSaving}
            />
          </div>

          {isBlockBots && (
            <Alert variant="destructive">
              <Info className="h-4 w-4" />
              <AlertDescription>
                <strong>Warning:</strong> Blocking bots will prevent search engines from crawling your site,
                which may negatively impact SEO. Only enable this for internal tools, APIs, or during bot attacks.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Detected Bot Types Info */}
        <div className="rounded-lg border p-4 space-y-2">
          <h4 className="text-sm font-medium">Detected Bot Types</h4>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>Search engines (Google, Bing, Yahoo, etc.)</li>
            <li>Social media crawlers (Facebook, Twitter, LinkedIn)</li>
            <li>SEO tools (Ahrefs, SEMrush, Moz)</li>
            <li>Monitoring services (UptimeRobot, Pingdom)</li>
            <li>Security scanners (Shodan, Nessus)</li>
            <li>AI crawlers (GPT, Claude, Perplexity)</li>
            <li>HTTP clients (curl, wget, requests)</li>
          </ul>
        </div>

        {/* Error Display */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Save Button */}
        {hasChanges && (
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsBlockBots(blockBots);
                setIsFilterBots(filterBotsFromStats);
              }}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Example API integration hook
 */
export function useDomainBotSettings(domainId: string) {
  const updateBotSettings = async (settings: { blockBots: boolean; filterBotsFromStats: boolean }) => {
    const response = await fetch(`/api/domains/${domainId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settings),
    });

    if (!response.ok) {
      throw new Error("Failed to update bot settings");
    }

    return response.json();
  };

  return { updateBotSettings };
}

/**
 * Example usage in domain settings page
 *
 * apps/web/src/app/domains/[id]/page.tsx
 */
/*
import { BotSettings, useDomainBotSettings } from "./_components/bot-settings";

export default function DomainSettingsPage({ params }: { params: { id: string } }) {
  const { data: domain } = useDomain(params.id);
  const { updateBotSettings } = useDomainBotSettings(params.id);

  if (!domain) return <div>Loading...</div>;

  return (
    <div className="space-y-6">
      <h1>Domain Settings</h1>

      <BotSettings
        domainId={domain.id}
        blockBots={domain.blockBots}
        filterBotsFromStats={domain.filterBotsFromStats}
        onUpdate={updateBotSettings}
      />

      // ... other settings components
    </div>
  );
}
*/

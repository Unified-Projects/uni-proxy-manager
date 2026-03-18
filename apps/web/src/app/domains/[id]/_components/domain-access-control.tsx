"use client";

import { useState, useEffect } from "react";
import { Shield, Plus, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
  Textarea,
  useToast,
  Skeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Alert,
  AlertDescription,
  AlertTitle,
} from "@uni-proxy-manager/ui";
import type { IpAccessMode } from "@/lib/types";
import {
  useDomainIpRule,
  useUpdateDomainIpRule,
  useToggleDomainIpRule,
  useValidateDomainIps,
} from "@/hooks/use-domain-advanced-config";

interface DomainAccessControlProps {
  domainId: string;
}

export function DomainAccessControl({ domainId }: DomainAccessControlProps) {
  const { toast } = useToast();
  const { data: ipRule, isLoading } = useDomainIpRule(domainId);
  const updateIpRule = useUpdateDomainIpRule();
  const toggleIpRule = useToggleDomainIpRule();
  const validateIps = useValidateDomainIps();

  const [mode, setMode] = useState<IpAccessMode>("whitelist");
  const [ipInput, setIpInput] = useState("");
  const [ipAddresses, setIpAddresses] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize form with data
  useEffect(() => {
    if (ipRule) {
      setMode(ipRule.mode);
      setIpAddresses(ipRule.ipAddresses);
      setDescription(ipRule.description || "");
      setHasChanges(false);
    }
  }, [ipRule]);

  const handleToggle = async () => {
    try {
      await toggleIpRule.mutateAsync(domainId);
      toast({
        title: ipRule?.enabled ? "IP rules disabled" : "IP rules enabled",
        description: `IP access control has been ${ipRule?.enabled ? "disabled" : "enabled"}.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to toggle IP rules",
        variant: "destructive",
      });
    }
  };

  const handleAddIp = async () => {
    if (!ipInput.trim()) return;

    // Validate the IP
    const result = await validateIps.mutateAsync({
      domainId,
      ipAddresses: [ipInput.trim()],
    });

    if (!result.valid) {
      setValidationErrors(result.errors);
      return;
    }

    const newIps = [...ipAddresses, ipInput.trim()];
    setIpAddresses(newIps);
    setIpInput("");
    setValidationErrors([]);
    setHasChanges(true);
  };

  const handleRemoveIp = (ip: string) => {
    setIpAddresses(ipAddresses.filter((i) => i !== ip));
    setHasChanges(true);
  };

  const handleBulkAdd = async () => {
    const ips = ipInput
      .split(/[\n,]/)
      .map((ip) => ip.trim())
      .filter((ip) => ip);

    if (ips.length === 0) return;

    // Validate all IPs
    const result = await validateIps.mutateAsync({
      domainId,
      ipAddresses: ips,
    });

    if (!result.valid) {
      setValidationErrors(result.errors);
      return;
    }

    const newIps = [...new Set([...ipAddresses, ...ips])];
    setIpAddresses(newIps);
    setIpInput("");
    setValidationErrors([]);
    setHasChanges(true);
  };

  const handleModeChange = (newMode: IpAccessMode) => {
    setMode(newMode);
    setHasChanges(true);
  };

  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    setHasChanges(true);
  };

  const handleSave = async () => {
    try {
      await updateIpRule.mutateAsync({
        domainId,
        data: {
          mode,
          ipAddresses,
          description: description || null,
        },
      });
      toast({
        title: "IP rules updated",
        description: "IP access control settings have been saved.",
      });
      setHasChanges(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save IP rules",
        variant: "destructive",
      });
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
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            IP Access Control
          </CardTitle>
          <CardDescription>
            Control access to this domain based on IP addresses or CIDR ranges
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={ipRule?.enabled ? "default" : "secondary"}>
            {ipRule?.enabled ? "Enabled" : "Disabled"}
          </Badge>
          <Switch
            checked={ipRule?.enabled || false}
            onCheckedChange={handleToggle}
            disabled={toggleIpRule.isPending}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Mode Selection */}
        <div className="space-y-3">
          <Label>Access Mode</Label>
          <Select value={mode} onValueChange={(value: IpAccessMode) => handleModeChange(value)}>
            <SelectTrigger className="w-[300px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="whitelist">
                Whitelist (Only allow listed IPs)
              </SelectItem>
              <SelectItem value="blacklist">
                Blacklist (Block listed IPs)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Mode Description */}
        <Alert variant={mode === "whitelist" ? "default" : "destructive"}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {mode === "whitelist" ? "Whitelist Mode" : "Blacklist Mode"}
          </AlertTitle>
          <AlertDescription>
            {mode === "whitelist"
              ? "Only IP addresses in the list below will be allowed to access this domain. All other IPs will be blocked."
              : "IP addresses in the list below will be blocked from accessing this domain. All other IPs will be allowed."}
          </AlertDescription>
        </Alert>

        {/* IP Input */}
        <div className="space-y-3">
          <Label htmlFor="ipInput">Add IP Addresses</Label>
          <div className="flex gap-2">
            <Textarea
              id="ipInput"
              value={ipInput}
              onChange={(e) => setIpInput(e.target.value)}
              placeholder="Enter IP addresses or CIDR ranges (one per line or comma-separated)&#10;Examples: 192.168.1.1, 10.0.0.0/24, 2001:db8::/32"
              className="min-h-[80px]"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleAddIp}
              disabled={!ipInput.trim() || validateIps.isPending}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Single IP
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleBulkAdd}
              disabled={!ipInput.trim() || validateIps.isPending}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add All
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Supports IPv4, IPv6, and CIDR notation (e.g., 192.168.0.0/16, 10.0.0.1)
          </p>
        </div>

        {/* Validation Errors */}
        {validationErrors.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Validation Errors</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4 mt-2">
                {validationErrors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* IP List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>
              {mode === "whitelist" ? "Allowed" : "Blocked"} IP Addresses ({ipAddresses.length})
            </Label>
          </div>
          {ipAddresses.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
              No IP addresses configured
            </div>
          ) : (
            <div className="border rounded-lg divide-y max-h-[300px] overflow-y-auto">
              {ipAddresses.map((ip, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between px-4 py-2 hover:bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <code className="text-sm">{ip}</code>
                    {ip.includes("/") && (
                      <Badge variant="outline" className="text-xs">
                        CIDR
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveIp(ip)}
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            placeholder="Optional description for this IP access configuration"
            className="min-h-[60px]"
          />
        </div>

        {/* Save Button */}
        {hasChanges && (
          <div className="flex justify-end pt-4 border-t">
            <Button onClick={handleSave} disabled={updateIpRule.isPending}>
              {updateIpRule.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

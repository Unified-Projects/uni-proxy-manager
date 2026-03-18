"use client";

import { useState, useEffect } from "react";
import { Shield, Plus, Trash2, Eye, Code } from "lucide-react";
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
  useToast,
  Skeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Separator,
} from "@uni-proxy-manager/ui";
import type { XFrameOptionsValue } from "@/lib/types";
import {
  useDomainSecurityHeaders,
  useUpdateDomainSecurityHeaders,
  useDomainSecurityHeadersPreview,
} from "@/hooks/use-domain-advanced-config";

interface DomainSecurityHeadersProps {
  domainId: string;
}

const DEFAULT_CORS_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];
const DEFAULT_CORS_HEADERS = ["Content-Type", "Authorization", "X-Requested-With"];

export function DomainSecurityHeaders({ domainId }: DomainSecurityHeadersProps) {
  const { toast } = useToast();
  const { data: headers, isLoading } = useDomainSecurityHeaders(domainId);
  const { data: previewHeaders, refetch: refetchPreview } = useDomainSecurityHeadersPreview(domainId);
  const updateHeaders = useUpdateDomainSecurityHeaders();

  const [previewOpen, setPreviewOpen] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // X-Frame-Options state
  const [xFrameEnabled, setXFrameEnabled] = useState(false);
  const [xFrameValue, setXFrameValue] = useState<XFrameOptionsValue>("deny");
  const [xFrameAllowFrom, setXFrameAllowFrom] = useState("");

  // CSP frame-ancestors state
  const [cspEnabled, setCspEnabled] = useState(false);
  const [cspFrameAncestors, setCspFrameAncestors] = useState<string[]>([]);
  const [cspInput, setCspInput] = useState("");

  // CORS state
  const [corsEnabled, setCorsEnabled] = useState(false);
  const [corsAllowOrigins, setCorsAllowOrigins] = useState<string[]>([]);
  const [corsOriginInput, setCorsOriginInput] = useState("");
  const [corsAllowMethods, setCorsAllowMethods] = useState<string[]>([...DEFAULT_CORS_METHODS]);
  const [corsAllowHeaders, setCorsAllowHeaders] = useState<string[]>([...DEFAULT_CORS_HEADERS]);
  const [corsHeaderInput, setCorsHeaderInput] = useState("");
  const [corsExposeHeaders, setCorsExposeHeaders] = useState<string[]>([]);
  const [corsExposeInput, setCorsExposeInput] = useState("");
  const [corsAllowCredentials, setCorsAllowCredentials] = useState(false);
  const [corsMaxAge, setCorsMaxAge] = useState<number | null>(null);

  // Initialize form with data
  useEffect(() => {
    if (headers) {
      setXFrameEnabled(headers.xFrameOptionsEnabled);
      setXFrameValue(headers.xFrameOptionsValue || "deny");
      setXFrameAllowFrom(headers.xFrameOptionsAllowFrom || "");
      setCspEnabled(headers.cspFrameAncestorsEnabled);
      setCspFrameAncestors(headers.cspFrameAncestors || []);
      setCorsEnabled(headers.corsEnabled);
      setCorsAllowOrigins(headers.corsAllowOrigins || []);
      setCorsAllowMethods(headers.corsAllowMethods || [...DEFAULT_CORS_METHODS]);
      setCorsAllowHeaders(headers.corsAllowHeaders || [...DEFAULT_CORS_HEADERS]);
      setCorsExposeHeaders(headers.corsExposeHeaders || []);
      setCorsAllowCredentials(headers.corsAllowCredentials);
      setCorsMaxAge(headers.corsMaxAge);
      setHasChanges(false);
    }
  }, [headers]);

  const markChanged = () => setHasChanges(true);

  const handleSave = async () => {
    try {
      await updateHeaders.mutateAsync({
        domainId,
        data: {
          xFrameOptionsEnabled: xFrameEnabled,
          xFrameOptionsValue: xFrameValue,
          xFrameOptionsAllowFrom: xFrameValue === "allow-from" ? xFrameAllowFrom : null,
          cspFrameAncestorsEnabled: cspEnabled,
          cspFrameAncestors,
          corsEnabled,
          corsAllowOrigins,
          corsAllowMethods,
          corsAllowHeaders,
          corsExposeHeaders,
          corsAllowCredentials,
          corsMaxAge: corsMaxAge || undefined,
        },
      });
      toast({
        title: "Security headers updated",
        description: "Security header configuration has been saved.",
      });
      setHasChanges(false);
      refetchPreview();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save security headers",
        variant: "destructive",
      });
    }
  };

  const addToList = (
    list: string[],
    setList: (val: string[]) => void,
    input: string,
    setInput: (val: string) => void
  ) => {
    const value = input.trim();
    if (value && !list.includes(value)) {
      setList([...list, value]);
      setInput("");
      markChanged();
    }
  };

  const removeFromList = (list: string[], setList: (val: string[]) => void, item: string) => {
    setList(list.filter((i) => i !== item));
    markChanged();
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
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Security Headers
            </CardTitle>
            <CardDescription>
              Configure security-related HTTP headers for this domain
            </CardDescription>
          </div>
          <Button variant="outline" onClick={() => setPreviewOpen(true)}>
            <Eye className="mr-2 h-4 w-4" />
            Preview Headers
          </Button>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="xframe" className="space-y-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="xframe">X-Frame-Options</TabsTrigger>
              <TabsTrigger value="csp">CSP Frame Ancestors</TabsTrigger>
              <TabsTrigger value="cors">CORS</TabsTrigger>
            </TabsList>

            {/* X-Frame-Options Tab */}
            <TabsContent value="xframe" className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">Enable X-Frame-Options</p>
                  <p className="text-sm text-muted-foreground">
                    Protect against clickjacking attacks by controlling iframe embedding
                  </p>
                </div>
                <Switch
                  checked={xFrameEnabled}
                  onCheckedChange={(checked) => {
                    setXFrameEnabled(checked);
                    markChanged();
                  }}
                />
              </div>

              {xFrameEnabled && (
                <div className="space-y-4 pl-4 border-l-2">
                  <div className="space-y-2">
                    <Label>X-Frame-Options Value</Label>
                    <Select
                      value={xFrameValue}
                      onValueChange={(value) => {
                        setXFrameValue(value as XFrameOptionsValue);
                        markChanged();
                      }}
                    >
                      <SelectTrigger className="w-[300px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="deny">
                          DENY - Block all iframe embedding
                        </SelectItem>
                        <SelectItem value="sameorigin">
                          SAMEORIGIN - Allow same origin only
                        </SelectItem>
                        <SelectItem value="allow-from">
                          ALLOW-FROM - Allow specific origin
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {xFrameValue === "allow-from" && (
                    <div className="space-y-2">
                      <Label htmlFor="allowFrom">Allow From Origin</Label>
                      <Input
                        id="allowFrom"
                        value={xFrameAllowFrom}
                        onChange={(e) => {
                          setXFrameAllowFrom(e.target.value);
                          markChanged();
                        }}
                        placeholder="https://trusted-site.com"
                      />
                      <p className="text-xs text-muted-foreground">
                        Note: ALLOW-FROM is deprecated in modern browsers. Consider using CSP
                        frame-ancestors instead.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* CSP Frame Ancestors Tab */}
            <TabsContent value="csp" className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">Enable CSP frame-ancestors</p>
                  <p className="text-sm text-muted-foreground">
                    Modern replacement for X-Frame-Options with more flexibility
                  </p>
                </div>
                <Switch
                  checked={cspEnabled}
                  onCheckedChange={(checked) => {
                    setCspEnabled(checked);
                    markChanged();
                  }}
                />
              </div>

              {cspEnabled && (
                <div className="space-y-4 pl-4 border-l-2">
                  <div className="space-y-2">
                    <Label>Allowed Frame Ancestors</Label>
                    <div className="flex gap-2">
                      <Input
                        value={cspInput}
                        onChange={(e) => setCspInput(e.target.value)}
                        placeholder="https://trusted-site.com or 'self'"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addToList(cspFrameAncestors, setCspFrameAncestors, cspInput, setCspInput);
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          addToList(cspFrameAncestors, setCspFrameAncestors, cspInput, setCspInput)
                        }
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (!cspFrameAncestors.includes("'self'")) {
                            setCspFrameAncestors([...cspFrameAncestors, "'self'"]);
                            markChanged();
                          }
                        }}
                      >
                        Add &apos;self&apos;
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (!cspFrameAncestors.includes("'none'")) {
                            setCspFrameAncestors(["'none'"]);
                            markChanged();
                          }
                        }}
                      >
                        Set to &apos;none&apos;
                      </Button>
                    </div>
                  </div>

                  {cspFrameAncestors.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {cspFrameAncestors.map((ancestor) => (
                        <Badge key={ancestor} variant="secondary" className="gap-1">
                          {ancestor}
                          <button
                            onClick={() =>
                              removeFromList(cspFrameAncestors, setCspFrameAncestors, ancestor)
                            }
                            className="ml-1 hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* CORS Tab */}
            <TabsContent value="cors" className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">Enable CORS Headers</p>
                  <p className="text-sm text-muted-foreground">
                    Configure Cross-Origin Resource Sharing (CORS) for API access
                  </p>
                </div>
                <Switch
                  checked={corsEnabled}
                  onCheckedChange={(checked) => {
                    setCorsEnabled(checked);
                    markChanged();
                  }}
                />
              </div>

              {corsEnabled && (
                <div className="space-y-6 pl-4 border-l-2">
                  {/* Allowed Origins */}
                  <div className="space-y-2">
                    <Label>Allowed Origins (Access-Control-Allow-Origin)</Label>
                    <div className="flex gap-2">
                      <Input
                        value={corsOriginInput}
                        onChange={(e) => setCorsOriginInput(e.target.value)}
                        placeholder="https://example.com or *"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addToList(
                              corsAllowOrigins,
                              setCorsAllowOrigins,
                              corsOriginInput,
                              setCorsOriginInput
                            );
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          addToList(
                            corsAllowOrigins,
                            setCorsAllowOrigins,
                            corsOriginInput,
                            setCorsOriginInput
                          )
                        }
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!corsAllowOrigins.includes("*")) {
                          setCorsAllowOrigins(["*"]);
                          markChanged();
                        }
                      }}
                    >
                      Allow All Origins (*)
                    </Button>
                    {corsAllowOrigins.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {corsAllowOrigins.map((origin) => (
                          <Badge key={origin} variant="secondary" className="gap-1">
                            {origin}
                            <button
                              onClick={() =>
                                removeFromList(corsAllowOrigins, setCorsAllowOrigins, origin)
                              }
                              className="ml-1 hover:text-destructive"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Allowed Methods */}
                  <div className="space-y-2">
                    <Label>Allowed Methods (Access-Control-Allow-Methods)</Label>
                    <div className="flex flex-wrap gap-2">
                      {["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"].map(
                        (method) => (
                          <Badge
                            key={method}
                            variant={corsAllowMethods.includes(method) ? "default" : "outline"}
                            className="cursor-pointer"
                            onClick={() => {
                              if (corsAllowMethods.includes(method)) {
                                setCorsAllowMethods(corsAllowMethods.filter((m) => m !== method));
                              } else {
                                setCorsAllowMethods([...corsAllowMethods, method]);
                              }
                              markChanged();
                            }}
                          >
                            {method}
                          </Badge>
                        )
                      )}
                    </div>
                  </div>

                  <Separator />

                  {/* Allowed Headers */}
                  <div className="space-y-2">
                    <Label>Allowed Headers (Access-Control-Allow-Headers)</Label>
                    <div className="flex gap-2">
                      <Input
                        value={corsHeaderInput}
                        onChange={(e) => setCorsHeaderInput(e.target.value)}
                        placeholder="X-Custom-Header"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addToList(
                              corsAllowHeaders,
                              setCorsAllowHeaders,
                              corsHeaderInput,
                              setCorsHeaderInput
                            );
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          addToList(
                            corsAllowHeaders,
                            setCorsAllowHeaders,
                            corsHeaderInput,
                            setCorsHeaderInput
                          )
                        }
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    {corsAllowHeaders.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {corsAllowHeaders.map((header) => (
                          <Badge key={header} variant="secondary" className="gap-1">
                            {header}
                            <button
                              onClick={() =>
                                removeFromList(corsAllowHeaders, setCorsAllowHeaders, header)
                              }
                              className="ml-1 hover:text-destructive"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Expose Headers */}
                  <div className="space-y-2">
                    <Label>Expose Headers (Access-Control-Expose-Headers)</Label>
                    <div className="flex gap-2">
                      <Input
                        value={corsExposeInput}
                        onChange={(e) => setCorsExposeInput(e.target.value)}
                        placeholder="X-Custom-Response-Header"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addToList(
                              corsExposeHeaders,
                              setCorsExposeHeaders,
                              corsExposeInput,
                              setCorsExposeInput
                            );
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          addToList(
                            corsExposeHeaders,
                            setCorsExposeHeaders,
                            corsExposeInput,
                            setCorsExposeInput
                          )
                        }
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    {corsExposeHeaders.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {corsExposeHeaders.map((header) => (
                          <Badge key={header} variant="secondary" className="gap-1">
                            {header}
                            <button
                              onClick={() =>
                                removeFromList(corsExposeHeaders, setCorsExposeHeaders, header)
                              }
                              className="ml-1 hover:text-destructive"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Additional Options */}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <p className="font-medium text-sm">Allow Credentials</p>
                        <p className="text-xs text-muted-foreground">
                          Access-Control-Allow-Credentials
                        </p>
                      </div>
                      <Switch
                        checked={corsAllowCredentials}
                        onCheckedChange={(checked) => {
                          setCorsAllowCredentials(checked);
                          markChanged();
                        }}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="maxAge">Max Age (seconds)</Label>
                      <Input
                        id="maxAge"
                        type="number"
                        value={corsMaxAge || ""}
                        onChange={(e) => {
                          setCorsMaxAge(e.target.value ? parseInt(e.target.value, 10) : null);
                          markChanged();
                        }}
                        placeholder="86400"
                      />
                      <p className="text-xs text-muted-foreground">
                        How long browsers can cache preflight response
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>

          {/* Save Button */}
          {hasChanges && (
            <div className="flex justify-end pt-4 border-t mt-6">
              <Button onClick={handleSave} disabled={updateHeaders.isPending}>
                {updateHeaders.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code className="h-5 w-5" />
              Security Headers Preview
            </DialogTitle>
            <DialogDescription>
              These headers will be added to responses from this domain
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {previewHeaders && Object.keys(previewHeaders).length > 0 ? (
              Object.entries(previewHeaders).map(([key, value]) => (
                <div key={key} className="font-mono text-sm bg-muted p-3 rounded-lg">
                  <span className="text-blue-600 dark:text-blue-400">{key}:</span>{" "}
                  <span className="text-green-600 dark:text-green-400">{value}</span>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground text-center py-4">
                No security headers configured
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

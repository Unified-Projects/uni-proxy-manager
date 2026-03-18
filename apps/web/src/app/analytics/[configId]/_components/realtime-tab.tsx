"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Users,
  FileText,
  Zap,
  Globe,
  Clock,
  Activity,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ScrollArea,
} from "@uni-proxy-manager/ui";
import { useAnalyticsLive } from "@/hooks/use-analytics-data";
import { analyticsDataApi } from "@/lib/api";
import type { AnalyticsLive } from "@/lib/types";

// ---------------------------------------------------------------------------
// Connection transport type
// ---------------------------------------------------------------------------

type TransportType = "websocket" | "polling" | "connecting";

// ---------------------------------------------------------------------------
// useRealtimeWebSocket - attempts a WS connection, falls back to polling
// ---------------------------------------------------------------------------

function useRealtimeWebSocket(configId: string) {
  const [transport, setTransport] = useState<TransportType>("connecting");
  const [wsData, setWsData] = useState<AnalyticsLive | null>(null);
  const [wsUpdatedAt, setWsUpdatedAt] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triedWsRef = useRef(false);

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  // Try a single URL. Calls onFailure if the connection never opens.
  const tryConnect = useCallback((url: string, onFailure?: () => void) => {
    cleanup();
    let opened = false;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      opened = true;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "auth_ok") {
          setTransport("websocket");
          return;
        }
        if (msg.type === "auth_error" || msg.type === "auth_timeout") {
          ws.close();
          onFailure?.();
          return;
        }
        if (msg.activeVisitors !== undefined) {
          setWsData(msg as AnalyticsLive);
          setWsUpdatedAt(Date.now());
        }
      } catch { /* ignore */ }
    };

    ws.onerror = () => { /* handled in onclose */ };

    ws.onclose = () => {
      wsRef.current = null;
      if (!opened) {
        onFailure?.();
      } else if (transport === "websocket") {
        // Lost an established connection — reconnect.
        setTransport("connecting");
        reconnectTimerRef.current = setTimeout(() => tryConnect(url), 5000);
      }
    };

    wsRef.current = ws;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport, cleanup]);

  useEffect(() => {
    if (triedWsRef.current) return;
    triedWsRef.current = true;

    analyticsDataApi.getLiveWsInfo(configId).then((info) => {
      if (!info.wsUrl) {
        setTransport("polling");
        return;
      }

      // Always receive wss:// from the server. Try it first.
      // On failure downgrade to ws://, then fall back to polling.
      const wssUrl = info.wsUrl;
      const wsUrl = wssUrl.replace(/^wss:/, "ws:");

      tryConnect(wssUrl, () => {
        // wss failed — try plain ws.
        tryConnect(wsUrl, () => {
          // ws also failed — fall back to polling.
          setTransport("polling");
        });
      });
    }).catch(() => {
      setTransport("polling");
    });

    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configId]);

  return { transport, wsData, wsUpdatedAt };
}

// ---------------------------------------------------------------------------
// RealtimeTab component
// ---------------------------------------------------------------------------

interface RealtimeTabProps {
  configId: string;
}

export function RealtimeTab({ configId }: RealtimeTabProps) {
  const { transport, wsData, wsUpdatedAt } =
    useRealtimeWebSocket(configId);

  // HTTP polling fallback -- always runs but only used when WS is unavailable.
  const {
    data: pollingData,
    isLoading: pollingLoading,
    dataUpdatedAt: pollingUpdatedAt,
  } = useAnalyticsLive(configId);

  // Use WebSocket data when available, otherwise fall back to polling.
  const usingWs = transport === "websocket" && wsData !== null;
  const liveData = usingWs ? wsData : pollingData;
  const dataUpdatedAt = usingWs ? wsUpdatedAt : pollingUpdatedAt;
  const isLoading = !usingWs && pollingLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const activeVisitors = liveData?.activeVisitors ?? 0;
  const activePages = liveData?.activePages ?? [];
  const recentEvents = liveData?.recentEvents ?? [];

  return (
    <div className="space-y-4">
      {/* Active visitors hero card */}
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-10">
          {/* Pulsing live indicator */}
          <div className="flex items-center gap-2 mb-4">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
            </span>
            <span className="text-sm font-medium text-green-600 uppercase tracking-wider">
              Live
            </span>
          </div>

          {/* Large visitor count */}
          <div className="flex items-baseline gap-3">
            <span className="text-7xl font-bold tabular-nums tracking-tight">
              {activeVisitors.toLocaleString()}
            </span>
          </div>
          <p className="text-muted-foreground mt-2 flex items-center gap-2">
            <Users className="h-4 w-4" />
            {activeVisitors === 1
              ? "active visitor right now"
              : "active visitors right now"}
          </p>

          {/* Transport indicator and last-updated timestamp */}
          <div className="flex items-center gap-3 mt-3">
            <TransportBadge transport={transport} />
            {dataUpdatedAt > 0 && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Last updated: {new Date(dataUpdatedAt).toLocaleTimeString()}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Active pages */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Active Pages
            </CardTitle>
            <CardDescription>
              Pages currently being viewed by visitors
            </CardDescription>
          </CardHeader>
          <CardContent>
            {activePages.length > 0 ? (
              <ScrollArea className="max-h-80">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Page</TableHead>
                      <TableHead className="text-right w-24">Visitors</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activePages.map((page, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-sm truncate max-w-[300px]">
                          {page.pathname}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary">
                            {page.visitors.toLocaleString()}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <Globe className="h-8 w-8" />
                <p className="text-sm">No active pages at the moment.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent events feed */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Recent Events
            </CardTitle>
            <CardDescription>
              Latest events from your site in real time
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentEvents.length > 0 ? (
              <ScrollArea className="max-h-80">
                <div className="space-y-3">
                  {recentEvents.map((event, idx) => (
                    <RecentEventItem key={idx} event={event} />
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <Activity className="h-8 w-8" />
                <p className="text-sm">No recent events to display.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transport badge - shows whether we are using WebSocket or HTTP polling
// ---------------------------------------------------------------------------

function TransportBadge({ transport }: { transport: TransportType }) {
  if (transport === "websocket") {
    return (
      <Badge
        variant="outline"
        className="text-xs gap-1 text-green-600 border-green-200"
      >
        <Wifi className="h-3 w-3" />
        WebSocket
      </Badge>
    );
  }

  if (transport === "connecting") {
    return (
      <Badge
        variant="outline"
        className="text-xs gap-1 text-amber-600 border-amber-200"
      >
        <Wifi className="h-3 w-3" />
        Connecting...
      </Badge>
    );
  }

  // Polling fallback.
  return (
    <Badge
      variant="outline"
      className="text-xs gap-1 text-muted-foreground"
    >
      <WifiOff className="h-3 w-3" />
      Polling (5s)
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Recent event item
// ---------------------------------------------------------------------------

function RecentEventItem({ event }: { event: Record<string, unknown> }) {
  const eventName = (event.name ?? event.eventName ?? event.type ?? "Unknown") as string;
  const pathname = (event.pathname ?? event.page ?? event.url ?? "") as string;
  const timestamp = event.timestamp ?? event.createdAt ?? event.time;
  const country = event.country as string | undefined;

  const formattedTime = timestamp
    ? new Date(timestamp as string).toLocaleTimeString()
    : null;

  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <div className="mt-0.5">
        <Zap className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{eventName}</span>
          {country && (
            <Badge variant="outline" className="text-xs shrink-0">
              {country}
            </Badge>
          )}
        </div>
        {pathname && (
          <p className="text-xs text-muted-foreground font-mono truncate">
            {pathname}
          </p>
        )}
      </div>
      {formattedTime && (
        <span className="text-xs text-muted-foreground shrink-0">
          {formattedTime}
        </span>
      )}
    </div>
  );
}

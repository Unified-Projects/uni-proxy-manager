"use client";

import { useState, useMemo } from "react";
import { MousePointerClick, ArrowLeft, FileText, Key } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@uni-proxy-manager/ui";
import {
  useAnalyticsEvents,
  useAnalyticsEventDetail,
} from "@/hooks/use-analytics-data";
import type { AnalyticsQueryParams } from "@/lib/types";

interface EventsTabProps {
  configId: string;
  params: AnalyticsQueryParams;
}

// Detail drill-down view for a single event
function EventDetailView({
  configId,
  eventName,
  params,
  onBack,
}: {
  configId: string;
  eventName: string;
  params: AnalyticsQueryParams;
  onBack: () => void;
}) {
  const { data: detail, isLoading } = useAnalyticsEventDetail(
    configId,
    eventName,
    params
  );

  // Compute total metadata count for percentage display
  const totalMetadataCount = useMemo(() => {
    if (!detail?.metadata || detail.metadata.length === 0) return 0;
    return detail.metadata.reduce((sum, m) => sum + m.count, 0);
  }, [detail]);

  // Compute total top-page count for percentage display
  const totalPageCount = useMemo(() => {
    if (!detail?.topPages || detail.topPages.length === 0) return 0;
    return detail.topPages.reduce((sum, p) => sum + p.count, 0);
  }, [detail]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with back button */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <CardTitle className="flex items-center gap-2">
                <MousePointerClick className="h-5 w-5" />
                <span className="font-mono">{detail?.eventName ?? eventName}</span>
              </CardTitle>
              <CardDescription>
                Event detail breakdown for the selected period
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Total Count</p>
              <p className="text-2xl font-bold">
                {detail?.totalCount?.toLocaleString() ?? "0"}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Unique Visitors</p>
              <p className="text-2xl font-bold">
                {detail?.uniqueVisitors?.toLocaleString() ?? "0"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Metadata breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Key className="h-4 w-4" />
            Metadata Breakdown
          </CardTitle>
          <CardDescription>
            Key-value pairs attached to this event
          </CardDescription>
        </CardHeader>
        <CardContent>
          {detail?.metadata && detail.metadata.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">% of Total</TableHead>
                  <TableHead className="w-48">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.metadata.map((meta, idx) => {
                  const pct =
                    totalMetadataCount > 0
                      ? (meta.count / totalMetadataCount) * 100
                      : 0;
                  return (
                    <TableRow key={`${meta.key}-${meta.value}-${idx}`}>
                      <TableCell className="font-mono text-sm">
                        {meta.key}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {meta.value}
                      </TableCell>
                      <TableCell className="text-right">
                        {meta.count.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {pct.toFixed(1)}%
                      </TableCell>
                      <TableCell>
                        <div className="h-2 w-full rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <p>No metadata recorded for this event.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top pages where the event fired */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            Top Pages
          </CardTitle>
          <CardDescription>
            Pages where this event was triggered most frequently
          </CardDescription>
        </CardHeader>
        <CardContent>
          {detail?.topPages && detail.topPages.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pathname</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">% of Total</TableHead>
                  <TableHead className="w-48">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.topPages.map((page) => {
                  const pct =
                    totalPageCount > 0
                      ? (page.count / totalPageCount) * 100
                      : 0;
                  return (
                    <TableRow key={page.pathname}>
                      <TableCell className="font-mono text-sm max-w-xs truncate">
                        {page.pathname}
                      </TableCell>
                      <TableCell className="text-right">
                        {page.count.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {pct.toFixed(1)}%
                      </TableCell>
                      <TableCell>
                        <div className="h-2 w-full rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <p>No page data available for this event.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function EventsTab({ configId, params }: EventsTabProps) {
  const { data: events, isLoading } = useAnalyticsEvents(configId, params);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);

  const totalCount = useMemo(() => {
    if (!events || events.length === 0) return 0;
    return events.reduce((sum, e) => sum + e.count, 0);
  }, [events]);

  // If an event is selected, show the drill-down detail view
  if (selectedEvent) {
    return (
      <EventDetailView
        configId={configId}
        eventName={selectedEvent}
        params={params}
        onBack={() => setSelectedEvent(null)}
      />
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MousePointerClick className="h-5 w-5" />
          Custom Events
        </CardTitle>
        <CardDescription>
          Tracked custom events and their occurrence for the selected period.
          Click an event name to view its detail breakdown.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {events && events.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event Name</TableHead>
                <TableHead className="text-right">Total Count</TableHead>
                <TableHead className="text-right">Unique Visitors</TableHead>
                <TableHead className="text-right">Avg. per Visitor</TableHead>
                <TableHead className="w-48">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => {
                const percentage =
                  totalCount > 0
                    ? (event.count / totalCount) * 100
                    : 0;
                const avgPerVisitor =
                  event.uniqueVisitors > 0
                    ? event.count / event.uniqueVisitors
                    : 0;

                return (
                  <TableRow key={event.name}>
                    <TableCell className="font-medium font-mono text-sm">
                      <button
                        type="button"
                        className="text-left underline decoration-dotted underline-offset-4 hover:text-primary transition-colors cursor-pointer"
                        onClick={() => setSelectedEvent(event.name)}
                      >
                        {event.name}
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      {event.count.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {event.uniqueVisitors.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {avgPerVisitor.toFixed(1)}
                    </TableCell>
                    <TableCell>
                      <div className="h-2 w-full rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.min(percentage, 100)}%` }}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <p>No custom event data available for the selected period.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useState, useMemo } from "react";
import { FileText, ExternalLink } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@uni-proxy-manager/ui";
import { useAnalyticsPages } from "@/hooks/use-analytics-data";
import type { AnalyticsQueryParams } from "@/lib/types";

interface PagesTabProps {
  configId: string;
  params: AnalyticsQueryParams;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

export function PagesTab({ configId, params }: PagesTabProps) {
  const { data: pagesData, isLoading } = useAnalyticsPages(configId, params);
  const [subTab, setSubTab] = useState("top");

  const totalPageViews = useMemo(() => {
    if (!pagesData?.pages) return 0;
    return pagesData.pages.reduce((sum, p) => sum + p.pageViews, 0);
  }, [pagesData]);

  const totalEntrySessions = useMemo(() => {
    if (!pagesData?.entryPages) return 0;
    return pagesData.entryPages.reduce((sum, p) => sum + p.sessions, 0);
  }, [pagesData]);

  const totalExitSessions = useMemo(() => {
    if (!pagesData?.exitPages) return 0;
    return pagesData.exitPages.reduce((sum, p) => sum + p.sessions, 0);
  }, [pagesData]);

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
          <FileText className="h-5 w-5" />
          Pages
        </CardTitle>
        <CardDescription>
          Page-level analytics breakdown for the selected period
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={subTab} onValueChange={setSubTab}>
          <TabsList>
            <TabsTrigger value="top">Top Pages</TabsTrigger>
            <TabsTrigger value="entry">Entry Pages</TabsTrigger>
            <TabsTrigger value="exit">Exit Pages</TabsTrigger>
            <TabsTrigger value="outbound">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Outbound Links
            </TabsTrigger>
          </TabsList>

          <TabsContent value="top">
            {pagesData?.pages && pagesData.pages.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pathname</TableHead>
                    <TableHead className="text-right">Page Views</TableHead>
                    <TableHead className="text-right">Unique Visitors</TableHead>
                    <TableHead className="text-right">% of Total</TableHead>
                    <TableHead className="text-right">Avg. Duration</TableHead>
                    <TableHead className="text-right">Scroll Depth</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagesData.pages.map((page) => (
                    <TableRow key={page.pathname}>
                      <TableCell className="font-mono text-sm max-w-xs truncate">
                        {page.pathname}
                      </TableCell>
                      <TableCell className="text-right">
                        {page.pageViews.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {page.uniqueVisitors.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {totalPageViews > 0
                          ? ((page.pageViews / totalPageViews) * 100).toFixed(1)
                          : "0.0"}
                        %
                      </TableCell>
                      <TableCell className="text-right">
                        {formatDuration(page.avgDurationMs)}
                      </TableCell>
                      <TableCell className="text-right">
                        {page.avgScrollDepthPct > 0 ? `${page.avgScrollDepthPct}%` : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <p>No page data available for the selected period.</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="entry">
            {pagesData?.entryPages && pagesData.entryPages.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pathname</TableHead>
                    <TableHead className="text-right">Visitors</TableHead>
                    <TableHead className="text-right">Sessions</TableHead>
                    <TableHead className="text-right">Entry Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagesData.entryPages.map((page) => (
                    <TableRow key={page.pathname}>
                      <TableCell className="font-mono text-sm max-w-xs truncate">
                        {page.pathname}
                      </TableCell>
                      <TableCell className="text-right">
                        {page.visitors.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {page.sessions.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {totalEntrySessions > 0
                          ? ((page.sessions / totalEntrySessions) * 100).toFixed(1)
                          : "0.0"}
                        %
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <p>No entry page data available for the selected period.</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="exit">
            {pagesData?.exitPages && pagesData.exitPages.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pathname</TableHead>
                    <TableHead className="text-right">Visitors</TableHead>
                    <TableHead className="text-right">Sessions</TableHead>
                    <TableHead className="text-right">Exit Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagesData.exitPages.map((page) => (
                    <TableRow key={page.pathname}>
                      <TableCell className="font-mono text-sm max-w-xs truncate">
                        {page.pathname}
                      </TableCell>
                      <TableCell className="text-right">
                        {page.visitors.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {page.sessions.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {totalExitSessions > 0
                          ? ((page.sessions / totalExitSessions) * 100).toFixed(1)
                          : "0.0"}
                        %
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <p>No exit page data available for the selected period.</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="outbound">
            {pagesData?.outboundLinks && pagesData.outboundLinks.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Destination</TableHead>
                    <TableHead>From Page</TableHead>
                    <TableHead className="text-right">Clicks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagesData.outboundLinks.map((link, i) => (
                    <TableRow key={`${link.destination}-${link.sourcePage}-${i}`}>
                      <TableCell className="text-sm max-w-xs truncate">
                        <a
                          href={link.destination}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-1"
                        >
                          {link.destination}
                          <ExternalLink className="h-3 w-3 flex-shrink-0" />
                        </a>
                      </TableCell>
                      <TableCell className="font-mono text-sm max-w-xs truncate">
                        {link.sourcePage}
                      </TableCell>
                      <TableCell className="text-right">
                        {link.clicks.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <p>No outbound link clicks recorded for the selected period.</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

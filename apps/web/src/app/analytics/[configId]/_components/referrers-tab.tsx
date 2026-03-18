"use client";

import { useState, useMemo } from "react";
import { Link2, Tag } from "lucide-react";
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
import { useAnalyticsReferrers, useAnalyticsUTM } from "@/hooks/use-analytics-data";
import type { AnalyticsQueryParams } from "@/lib/types";

interface ReferrersTabProps {
  configId: string;
  params: AnalyticsQueryParams;
}

export function ReferrersTab({ configId, params }: ReferrersTabProps) {
  const { data: referrers, isLoading } = useAnalyticsReferrers(configId, params);
  const { data: utmData, isLoading: isUtmLoading } = useAnalyticsUTM(configId, params);
  const [utmTab, setUtmTab] = useState("sources");

  const totalVisitors = useMemo(() => {
    if (!referrers || referrers.length === 0) return 0;
    return referrers.reduce((sum, r) => sum + r.visitors, 0);
  }, [referrers]);

  // Compute total UTM source visitors for percentage calculations
  const totalUtmSourceVisitors = useMemo(() => {
    if (!utmData?.sources || utmData.sources.length === 0) return 0;
    return utmData.sources.reduce((sum, s) => sum + s.visitors, 0);
  }, [utmData]);

  const totalUtmCampaignVisitors = useMemo(() => {
    if (!utmData?.campaigns || utmData.campaigns.length === 0) return 0;
    return utmData.campaigns.reduce((sum, c) => sum + c.visitors, 0);
  }, [utmData]);

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
    <div className="space-y-4">
      {/* Referrer domains table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Referrers
          </CardTitle>
          <CardDescription>
            Traffic sources and referring domains for the selected period
          </CardDescription>
        </CardHeader>
        <CardContent>
          {referrers && referrers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead className="text-right">Visitors</TableHead>
                  <TableHead className="text-right">Page Views</TableHead>
                  <TableHead className="text-right">Percentage</TableHead>
                  <TableHead className="w-48">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {referrers.map((referrer) => {
                  const percentage =
                    totalVisitors > 0
                      ? (referrer.visitors / totalVisitors) * 100
                      : 0;

                  return (
                    <TableRow key={referrer.domain}>
                      <TableCell className="font-medium">
                        {referrer.domain === "(direct)" ||
                        referrer.domain === "" ? (
                          <span className="text-muted-foreground italic">
                            Direct / None
                          </span>
                        ) : (
                          referrer.domain
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {referrer.visitors.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {referrer.pageViews.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {percentage.toFixed(1)}%
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
              <p>No referrer data available for the selected period.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* UTM breakdown section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            UTM Breakdown
          </CardTitle>
          <CardDescription>
            Campaign tracking parameters for the selected period
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isUtmLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : (
            <Tabs value={utmTab} onValueChange={setUtmTab}>
              <TabsList>
                <TabsTrigger value="sources">Sources</TabsTrigger>
                <TabsTrigger value="mediums">Mediums</TabsTrigger>
                <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
              </TabsList>

              {/* UTM Sources */}
              <TabsContent value="sources">
                {utmData?.sources && utmData.sources.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source</TableHead>
                        <TableHead className="text-right">Visitors</TableHead>
                        <TableHead className="text-right">Page Views</TableHead>
                        <TableHead className="text-right">% of Total</TableHead>
                        <TableHead className="w-48">Share</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {utmData.sources.map((item) => {
                        const pct =
                          totalUtmSourceVisitors > 0
                            ? (item.visitors / totalUtmSourceVisitors) * 100
                            : 0;
                        return (
                          <TableRow key={item.source}>
                            <TableCell className="font-medium">
                              {item.source || (
                                <span className="text-muted-foreground italic">
                                  (none)
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {item.visitors.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right">
                              {item.pageViews.toLocaleString()}
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
                    <p>No UTM source data available for the selected period.</p>
                  </div>
                )}
              </TabsContent>

              {/* UTM Mediums */}
              <TabsContent value="mediums">
                {utmData?.mediums && utmData.mediums.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Medium</TableHead>
                        <TableHead className="text-right">Visitors</TableHead>
                        <TableHead className="text-right">Percentage</TableHead>
                        <TableHead className="w-48">Share</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {utmData.mediums.map((item) => (
                        <TableRow key={item.medium}>
                          <TableCell className="font-medium">
                            {item.medium || (
                              <span className="text-muted-foreground italic">
                                (none)
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {item.visitors.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {item.percentage.toFixed(1)}%
                          </TableCell>
                          <TableCell>
                            <div className="h-2 w-full rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary transition-all"
                                style={{
                                  width: `${Math.min(item.percentage, 100)}%`,
                                }}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <p>No UTM medium data available for the selected period.</p>
                  </div>
                )}
              </TabsContent>

              {/* UTM Campaigns */}
              <TabsContent value="campaigns">
                {utmData?.campaigns && utmData.campaigns.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Campaign</TableHead>
                        <TableHead className="text-right">Visitors</TableHead>
                        <TableHead className="text-right">Page Views</TableHead>
                        <TableHead className="text-right">% of Total</TableHead>
                        <TableHead className="w-48">Share</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {utmData.campaigns.map((item) => {
                        const pct =
                          totalUtmCampaignVisitors > 0
                            ? (item.visitors / totalUtmCampaignVisitors) * 100
                            : 0;
                        return (
                          <TableRow key={item.campaign}>
                            <TableCell className="font-medium">
                              {item.campaign || (
                                <span className="text-muted-foreground italic">
                                  (none)
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {item.visitors.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right">
                              {item.pageViews.toLocaleString()}
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
                    <p>No UTM campaign data available for the selected period.</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

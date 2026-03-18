"use client";

import { useMemo } from "react";
import { Monitor, Smartphone, Tablet, HelpCircle, Globe, Cpu } from "lucide-react";
import {
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
import { useAnalyticsDevices } from "@/hooks/use-analytics-data";
import type { AnalyticsQueryParams } from "@/lib/types";

interface DevicesTabProps {
  configId: string;
  params: AnalyticsQueryParams;
}

interface DeviceTypeRowProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  total: number;
}

function DeviceTypeRow({ icon, label, count, total }: DeviceTypeRowProps) {
  const percentage = total > 0 ? (count / total) * 100 : 0;

  return (
    <div className="flex items-center gap-4 py-3">
      <div className="flex items-center gap-2 w-32 shrink-0">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex-1">
        <div className="h-2 w-full rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-sm tabular-nums w-16 text-right">
          {count.toLocaleString()}
        </span>
        <span className="text-sm text-muted-foreground tabular-nums w-14 text-right">
          {percentage.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

export function DevicesTab({ configId, params }: DevicesTabProps) {
  const { data: devicesData, isLoading } = useAnalyticsDevices(configId, params);

  const deviceTotal = useMemo(() => {
    if (!devicesData?.devices) return 0;
    const d = devicesData.devices;
    return d.desktop + d.mobile + d.tablet + d.other;
  }, [devicesData]);

  const browserTotal = useMemo(() => {
    if (!devicesData?.browsers) return 0;
    return devicesData.browsers.reduce((sum, b) => sum + b.count, 0);
  }, [devicesData]);

  const osTotal = useMemo(() => {
    if (!devicesData?.os) return 0;
    return devicesData.os.reduce((sum, o) => sum + o.count, 0);
  }, [devicesData]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </CardContent>
        </Card>
        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent className="space-y-2">
                {Array.from({ length: 5 }).map((_, j) => (
                  <Skeleton key={j} className="h-10" />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const devices = devicesData?.devices;
  const browsers = devicesData?.browsers;
  const operatingSystems = devicesData?.os;

  return (
    <div className="space-y-6">
      {/* Device Types */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            Device Types
          </CardTitle>
          <CardDescription>
            Breakdown of visitors by device category
          </CardDescription>
        </CardHeader>
        <CardContent>
          {devices && deviceTotal > 0 ? (
            <div className="divide-y">
              <DeviceTypeRow
                icon={<Monitor className="h-4 w-4 text-muted-foreground" />}
                label="Desktop"
                count={devices.desktop}
                total={deviceTotal}
              />
              <DeviceTypeRow
                icon={<Smartphone className="h-4 w-4 text-muted-foreground" />}
                label="Mobile"
                count={devices.mobile}
                total={deviceTotal}
              />
              <DeviceTypeRow
                icon={<Tablet className="h-4 w-4 text-muted-foreground" />}
                label="Tablet"
                count={devices.tablet}
                total={deviceTotal}
              />
              <DeviceTypeRow
                icon={<HelpCircle className="h-4 w-4 text-muted-foreground" />}
                label="Other"
                count={devices.other}
                total={deviceTotal}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <p>No device data available for the selected period.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Browsers */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Browsers
            </CardTitle>
            <CardDescription>
              Visitor distribution by web browser
            </CardDescription>
          </CardHeader>
          <CardContent>
            {browsers && browsers.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Browser</TableHead>
                    <TableHead className="text-right">Visitors</TableHead>
                    <TableHead className="text-right">Percentage</TableHead>
                    <TableHead className="w-32">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {browsers.map((browser) => {
                    const percentage =
                      browserTotal > 0
                        ? (browser.count / browserTotal) * 100
                        : 0;

                    return (
                      <TableRow key={browser.name}>
                        <TableCell className="font-medium">
                          {browser.name || (
                            <span className="text-muted-foreground italic">
                              Unknown
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {browser.count.toLocaleString()}
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
                <p>No browser data available for the selected period.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Operating Systems */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5" />
              Operating Systems
            </CardTitle>
            <CardDescription>
              Visitor distribution by operating system
            </CardDescription>
          </CardHeader>
          <CardContent>
            {operatingSystems && operatingSystems.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operating System</TableHead>
                    <TableHead className="text-right">Visitors</TableHead>
                    <TableHead className="text-right">Percentage</TableHead>
                    <TableHead className="w-32">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operatingSystems.map((os) => {
                    const percentage =
                      osTotal > 0
                        ? (os.count / osTotal) * 100
                        : 0;

                    return (
                      <TableRow key={os.name}>
                        <TableCell className="font-medium">
                          {os.name || (
                            <span className="text-muted-foreground italic">
                              Unknown
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {os.count.toLocaleString()}
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
                <p>No operating system data available for the selected period.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

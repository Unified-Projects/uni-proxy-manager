"use client";

import { useState, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  LineChart,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@uni-proxy-manager/ui";
import { TrendingUp } from "lucide-react";
import { formatNumber, formatBytes, getStatusColor } from "@/lib/format";
import type { TrafficDataPoint, MetricFilter } from "@/types/metrics";
import { EnhancedMetricTooltip } from "./enhanced-metric-tooltip";
import { MetricFilterBar } from "./metric-filter-bar";

interface TrafficChartProps {
  data: TrafficDataPoint[];
  title?: string;
  defaultFilter?: MetricFilter;
  locationData?: Array<{ country: string; count: number }>;
  uniqueVisitorsTotal?: number;
}

export function TrafficChart({
  data,
  title = "Traffic",
  defaultFilter = "total",
  locationData,
  uniqueVisitorsTotal,
}: TrafficChartProps) {
  const [selectedFilter, setSelectedFilter] = useState<MetricFilter>(defaultFilter);

  const chartData = useMemo(() => {
    return data.map((d) => ({
      time: new Date(d.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      timestamp: d.timestamp,
      totalRequests: d.totalRequests,
      uniqueVisitors: d.uniqueVisitors,
      httpRequests: d.httpRequests || 0,
      httpsRequests: d.httpsRequests || 0,
      status2xx: d.status2xx || 0,
      status3xx: d.status3xx || 0,
      status4xx: d.status4xx || 0,
      status5xx: d.status5xx || 0,
      bytesIn: d.bytesIn || 0,
      bytesOut: d.bytesOut || 0,
      currentConnections: d.currentConnections || 0,
      maxConnections: d.maxConnections || 0,
    }));
  }, [data]);

  const hasData = chartData.length > 0;

  const calculateTotal = useMemo(() => {
    if (!hasData) return 0;

    switch (selectedFilter) {
      case "total":
        return chartData.reduce((sum, d) => sum + d.totalRequests, 0);
      case "visitors":
        // Use deduplicated total if provided, otherwise sum per-interval counts
        return uniqueVisitorsTotal ?? chartData.reduce((sum, d) => sum + d.uniqueVisitors, 0);
      case "protocol":
        return chartData.reduce((sum, d) => sum + d.httpRequests + d.httpsRequests, 0);
      case "status":
        return chartData.reduce(
          (sum, d) => sum + d.status2xx + d.status3xx + d.status4xx + d.status5xx,
          0
        );
      case "bandwidth":
        return chartData.reduce((sum, d) => sum + d.bytesIn + d.bytesOut, 0);
      default:
        return 0;
    }
  }, [chartData, selectedFilter, hasData, uniqueVisitorsTotal]);

  const getFilterLabel = (filter: MetricFilter): string => {
    switch (filter) {
      case "total":
        return "Total Requests";
      case "visitors":
        return "Unique Visitors";
      case "protocol":
        return "Protocol Distribution";
      case "status":
        return "Status Codes";
      case "bandwidth":
        return "Total Bandwidth";
      default:
        return "";
    }
  };

  const formatTotalValue = (value: number): string => {
    if (selectedFilter === "bandwidth") {
      return formatBytes(value);
    }
    return formatNumber(value);
  };

  const renderChart = () => {
    const commonProps = {
      data: chartData,
      margin: { top: 5, right: 5, left: 5, bottom: 5 },
    };

    const commonAxisProps = {
      stroke: "hsl(var(--muted-foreground))",
      fontSize: 12,
      tickLine: false,
      axisLine: false,
    };

    switch (selectedFilter) {
      case "total":
      case "visitors":
        const dataKey = selectedFilter === "total" ? "totalRequests" : "uniqueVisitors";
        return (
          <AreaChart {...commonProps}>
            <defs>
              <linearGradient id="colorPrimary" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="time" {...commonAxisProps} />
            <YAxis {...commonAxisProps} tickFormatter={formatNumber} />
            <Tooltip
              content={(props) => (
                <EnhancedMetricTooltip
                  {...props}
                  filter={selectedFilter}
                  locationData={locationData}
                />
              )}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fill="url(#colorPrimary)"
              dot={false}
              activeDot={false}
            />
          </AreaChart>
        );

      case "protocol":
        return (
          <AreaChart {...commonProps}>
            <defs>
              <linearGradient id="colorHttp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorHttps" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="time" {...commonAxisProps} />
            <YAxis {...commonAxisProps} tickFormatter={formatNumber} />
            <Tooltip
              content={(props) => (
                <EnhancedMetricTooltip
                  {...props}
                  filter={selectedFilter}
                  locationData={locationData}
                />
              )}
            />
            <Area
              type="monotone"
              dataKey="httpRequests"
              stackId="1"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#colorHttp)"
              dot={false}
              activeDot={false}
            />
            <Area
              type="monotone"
              dataKey="httpsRequests"
              stackId="1"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#colorHttps)"
              dot={false}
              activeDot={false}
            />
          </AreaChart>
        );

      case "status":
        return (
          <AreaChart {...commonProps}>
            <defs>
              <linearGradient id="color2xx" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={getStatusColor("2xx")} stopOpacity={0.3} />
                <stop offset="95%" stopColor={getStatusColor("2xx")} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="color3xx" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={getStatusColor("3xx")} stopOpacity={0.3} />
                <stop offset="95%" stopColor={getStatusColor("3xx")} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="color4xx" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={getStatusColor("4xx")} stopOpacity={0.3} />
                <stop offset="95%" stopColor={getStatusColor("4xx")} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="color5xx" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={getStatusColor("5xx")} stopOpacity={0.3} />
                <stop offset="95%" stopColor={getStatusColor("5xx")} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="time" {...commonAxisProps} />
            <YAxis {...commonAxisProps} tickFormatter={formatNumber} />
            <Tooltip
              content={(props) => (
                <EnhancedMetricTooltip
                  {...props}
                  filter={selectedFilter}
                  locationData={locationData}
                />
              )}
            />
            <Area
              type="monotone"
              dataKey="status2xx"
              stackId="1"
              stroke={getStatusColor("2xx")}
              strokeWidth={2}
              fill="url(#color2xx)"
              dot={false}
              activeDot={false}
            />
            <Area
              type="monotone"
              dataKey="status3xx"
              stackId="1"
              stroke={getStatusColor("3xx")}
              strokeWidth={2}
              fill="url(#color3xx)"
              dot={false}
              activeDot={false}
            />
            <Area
              type="monotone"
              dataKey="status4xx"
              stackId="1"
              stroke={getStatusColor("4xx")}
              strokeWidth={2}
              fill="url(#color4xx)"
              dot={false}
              activeDot={false}
            />
            <Area
              type="monotone"
              dataKey="status5xx"
              stackId="1"
              stroke={getStatusColor("5xx")}
              strokeWidth={2}
              fill="url(#color5xx)"
              dot={false}
              activeDot={false}
            />
          </AreaChart>
        );

      case "bandwidth":
        return (
          <AreaChart {...commonProps}>
            <defs>
              <linearGradient id="colorBytesIn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorBytesOut" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="time" {...commonAxisProps} />
            <YAxis {...commonAxisProps} tickFormatter={formatBytes} />
            <Tooltip
              content={(props) => (
                <EnhancedMetricTooltip
                  {...props}
                  filter={selectedFilter}
                  locationData={locationData}
                />
              )}
            />
            <Area
              type="monotone"
              dataKey="bytesIn"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#colorBytesIn)"
              dot={false}
              activeDot={false}
            />
            <Area
              type="monotone"
              dataKey="bytesOut"
              stroke="#a855f7"
              strokeWidth={2}
              fill="url(#colorBytesOut)"
              dot={false}
              activeDot={false}
            />
          </AreaChart>
        );

      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-row items-center justify-between">
          <CardTitle>{title}</CardTitle>
          <div className="flex items-center gap-3">
            <MetricFilterBar value={selectedFilter} onChange={setSelectedFilter} />
            {hasData && (
              <div className="text-right">
                <div className="text-2xl font-bold">{formatTotalValue(calculateTotal)}</div>
                <p className="text-xs text-muted-foreground">{getFilterLabel(selectedFilter)}</p>
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <ResponsiveContainer width="100%" height={300}>
            {renderChart()}
          </ResponsiveContainer>
        ) : (
          <div className="flex h-[300px] flex-col items-center justify-center text-center">
            <TrendingUp className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-lg font-medium text-muted-foreground">No traffic data available</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Traffic data will appear here once your domains receive requests
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

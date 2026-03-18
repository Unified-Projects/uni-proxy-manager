"use client";

import { formatNumber, formatBytes, formatPercent, getStatusColor, type StatusRange } from "@/lib/format";
import type { MetricFilter, TrafficDataPoint } from "@/types/metrics";

interface EnhancedTooltipProps {
  active?: boolean;
  payload?: readonly any[];
  label?: string | number;
  filter: MetricFilter;
  dataPoint?: TrafficDataPoint;
  locationData?: Array<{ country: string; count: number }>;
}

export function EnhancedMetricTooltip({
  active,
  payload,
  label,
  filter,
  dataPoint,
  locationData,
}: EnhancedTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  // Get the data point from payload if not provided
  const data = dataPoint || payload[0]?.payload;
  if (!data) return null;

  const renderContent = () => {
    switch (filter) {
      case "total":
        return (
          <>
            <div className="font-semibold mb-2">
              {formatNumber(data.totalRequests)} Total Requests
            </div>
            {(data.status2xx || data.status3xx || data.status4xx || data.status5xx) && (
              <div className="space-y-1 text-xs border-t pt-2 mt-2">
                <div className="font-medium mb-1">Status Code Breakdown:</div>
                {data.status2xx > 0 && (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: getStatusColor("2xx") }}
                      />
                      <span>2xx (Success)</span>
                    </div>
                    <span className="font-medium">{formatNumber(data.status2xx)}</span>
                  </div>
                )}
                {data.status3xx > 0 && (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: getStatusColor("3xx") }}
                      />
                      <span>3xx (Redirect)</span>
                    </div>
                    <span className="font-medium">{formatNumber(data.status3xx)}</span>
                  </div>
                )}
                {data.status4xx > 0 && (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: getStatusColor("4xx") }}
                      />
                      <span>4xx (Client Error)</span>
                    </div>
                    <span className="font-medium">{formatNumber(data.status4xx)}</span>
                  </div>
                )}
                {data.status5xx > 0 && (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: getStatusColor("5xx") }}
                      />
                      <span>5xx (Server Error)</span>
                    </div>
                    <span className="font-medium">{formatNumber(data.status5xx)}</span>
                  </div>
                )}
              </div>
            )}
          </>
        );

      case "visitors":
        return (
          <>
            <div className="font-semibold mb-2">
              {formatNumber(data.uniqueVisitors)} Unique Visitors
            </div>
            <div className="text-xs space-y-1">
              <div className="flex justify-between gap-3">
                <span>Total Requests:</span>
                <span className="font-medium">{formatNumber(data.totalRequests)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span>Requests per Visitor:</span>
                <span className="font-medium">
                  {data.uniqueVisitors > 0
                    ? (data.totalRequests / data.uniqueVisitors).toFixed(1)
                    : "0"}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span>Unique Ratio:</span>
                <span className="font-medium">
                  {formatPercent(data.uniqueVisitors, data.totalRequests)}
                </span>
              </div>
            </div>
          </>
        );

      case "protocol":
        const httpReq = data.httpRequests || 0;
        const httpsReq = data.httpsRequests || 0;
        const totalProto = httpReq + httpsReq;
        return (
          <>
            <div className="font-semibold mb-2">Protocol Distribution</div>
            <div className="text-xs space-y-1">
              <div className="flex justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <span>HTTP:</span>
                </div>
                <span className="font-medium">
                  {formatNumber(httpReq)} ({formatPercent(httpReq, totalProto)})
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span>HTTPS:</span>
                </div>
                <span className="font-medium">
                  {formatNumber(httpsReq)} ({formatPercent(httpsReq, totalProto)})
                </span>
              </div>
            </div>
          </>
        );

      case "status":
        const total = (data.status2xx || 0) + (data.status3xx || 0) + (data.status4xx || 0) + (data.status5xx || 0);
        return (
          <>
            <div className="font-semibold mb-2">Status Code Distribution</div>
            <div className="text-xs space-y-1">
              {data.status2xx > 0 && (
                <div className="flex justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: getStatusColor("2xx") }}
                    />
                    <span>2xx Success:</span>
                  </div>
                  <span className="font-medium">
                    {formatNumber(data.status2xx)} ({formatPercent(data.status2xx, total)})
                  </span>
                </div>
              )}
              {data.status3xx > 0 && (
                <div className="flex justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: getStatusColor("3xx") }}
                    />
                    <span>3xx Redirect:</span>
                  </div>
                  <span className="font-medium">
                    {formatNumber(data.status3xx)} ({formatPercent(data.status3xx, total)})
                  </span>
                </div>
              )}
              {data.status4xx > 0 && (
                <div className="flex justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: getStatusColor("4xx") }}
                    />
                    <span>4xx Client Error:</span>
                  </div>
                  <span className="font-medium">
                    {formatNumber(data.status4xx)} ({formatPercent(data.status4xx, total)})
                  </span>
                </div>
              )}
              {data.status5xx > 0 && (
                <div className="flex justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: getStatusColor("5xx") }}
                    />
                    <span>5xx Server Error:</span>
                  </div>
                  <span className="font-medium">
                    {formatNumber(data.status5xx)} ({formatPercent(data.status5xx, total)})
                  </span>
                </div>
              )}
            </div>
          </>
        );

      case "bandwidth":
        const totalBytes = (data.bytesIn || 0) + (data.bytesOut || 0);
        return (
          <>
            <div className="font-semibold mb-2">Bandwidth Usage</div>
            <div className="text-xs space-y-1">
              <div className="flex justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <span>Bytes In:</span>
                </div>
                <span className="font-medium">{formatBytes(data.bytesIn || 0)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-purple-500" />
                  <span>Bytes Out:</span>
                </div>
                <span className="font-medium">{formatBytes(data.bytesOut || 0)}</span>
              </div>
              <div className="flex justify-between gap-3 border-t pt-1 mt-1">
                <span className="font-medium">Total:</span>
                <span className="font-medium">{formatBytes(totalBytes)}</span>
              </div>
            </div>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div className="bg-card border border-border rounded-md p-3 shadow-lg min-w-[200px]">
      <div className="text-xs text-muted-foreground mb-2">{label}</div>
      {renderContent()}
      {locationData && locationData.length > 0 && (
        <div className="border-t pt-2 mt-2 text-xs">
          <div className="font-medium mb-1">Top Locations:</div>
          <div className="space-y-1">
            {locationData.slice(0, 3).map((loc, i) => (
              <div key={i} className="flex justify-between gap-3">
                <span>{loc.country}</span>
                <span className="font-medium">{formatNumber(loc.count)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export interface TrafficDataPoint {
  timestamp: string;
  totalRequests: number;
  uniqueVisitors: number;
  httpRequests?: number;
  httpsRequests?: number;
  status2xx?: number;
  status3xx?: number;
  status4xx?: number;
  status5xx?: number;
  bytesIn?: number;
  bytesOut?: number;
  currentConnections?: number;
  maxConnections?: number;
}

export type MetricFilter =
  | "total"
  | "visitors"
  | "protocol"
  | "status"
  | "bandwidth";

export interface ChartSeries {
  dataKey: string;
  color: string;
  label: string;
  formatter?: (value: number) => string;
}

export interface TooltipMetric {
  label: string;
  value: number;
  color: string;
  formatter?: (value: number) => string;
}

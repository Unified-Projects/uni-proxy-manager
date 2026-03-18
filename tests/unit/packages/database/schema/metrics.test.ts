/**
 * Traffic Metrics Schema Unit Tests
 *
 * Tests for the traffic metrics database schema definitions.
 */

import { describe, it, expect } from "vitest";
import {
  trafficMetrics,
  type TrafficMetric,
  type NewTrafficMetric,
} from "../../../../../packages/database/src/schema/metrics";

describe("Traffic Metrics Schema", () => {
  // ============================================================================
  // Table Structure Tests
  // ============================================================================

  describe("trafficMetrics table", () => {
    it("should have id as primary key", () => {
      const idColumn = trafficMetrics.id;
      expect(idColumn.name).toBe("id");
      expect(idColumn.dataType).toBe("string");
    });

    it("should have domainId as required field", () => {
      const domainIdColumn = trafficMetrics.domainId;
      expect(domainIdColumn.name).toBe("domain_id");
      expect(domainIdColumn.notNull).toBe(true);
    });

    it("should have timestamp as required field", () => {
      const timestampColumn = trafficMetrics.timestamp;
      expect(timestampColumn.name).toBe("timestamp");
      expect(timestampColumn.notNull).toBe(true);
    });

    it("should have request counters with defaults", () => {
      expect(trafficMetrics.totalRequests.name).toBe("total_requests");
      expect(trafficMetrics.httpRequests.name).toBe("http_requests");
      expect(trafficMetrics.httpsRequests.name).toBe("https_requests");
      expect(trafficMetrics.totalRequests.notNull).toBe(true);
      expect(trafficMetrics.totalRequests.hasDefault).toBe(true);
    });

    it("should have response code counters with defaults", () => {
      expect(trafficMetrics.status2xx.name).toBe("status_2xx");
      expect(trafficMetrics.status3xx.name).toBe("status_3xx");
      expect(trafficMetrics.status4xx.name).toBe("status_4xx");
      expect(trafficMetrics.status5xx.name).toBe("status_5xx");
      expect(trafficMetrics.status2xx.hasDefault).toBe(true);
      expect(trafficMetrics.status3xx.hasDefault).toBe(true);
      expect(trafficMetrics.status4xx.hasDefault).toBe(true);
      expect(trafficMetrics.status5xx.hasDefault).toBe(true);
    });

    it("should have traffic volume fields as bigint", () => {
      expect(trafficMetrics.bytesIn.name).toBe("bytes_in");
      expect(trafficMetrics.bytesOut.name).toBe("bytes_out");
      // Drizzle bigint columns have columnType property instead of dataType
      expect(trafficMetrics.bytesIn.columnType).toBe("PgBigInt53");
      expect(trafficMetrics.bytesOut.columnType).toBe("PgBigInt53");
    });

    it("should have connection stats fields", () => {
      expect(trafficMetrics.currentConnections.name).toBe("current_connections");
      expect(trafficMetrics.maxConnections.name).toBe("max_connections");
      expect(trafficMetrics.currentConnections.notNull).toBe(true);
      expect(trafficMetrics.maxConnections.notNull).toBe(true);
    });

    it("should have createdAt timestamp", () => {
      const createdAtColumn = trafficMetrics.createdAt;
      expect(createdAtColumn.name).toBe("created_at");
      expect(createdAtColumn.notNull).toBe(true);
      expect(createdAtColumn.hasDefault).toBe(true);
    });
  });

  // ============================================================================
  // Type Tests
  // ============================================================================

  describe("TrafficMetric types", () => {
    it("should export TrafficMetric select type", () => {
      const metric: TrafficMetric = {
        id: "metric-1",
        domainId: "domain-1",
        timestamp: new Date(),
        totalRequests: 10000,
        httpRequests: 1000,
        httpsRequests: 9000,
        status2xx: 9500,
        status3xx: 200,
        status4xx: 250,
        status5xx: 50,
        bytesIn: 50000000,
        bytesOut: 250000000,
        currentConnections: 150,
        maxConnections: 500,
        createdAt: new Date(),
      };

      expect(metric.id).toBe("metric-1");
      expect(metric.totalRequests).toBe(10000);
      expect(metric.bytesOut).toBe(250000000);
    });

    it("should export NewTrafficMetric insert type with minimal fields", () => {
      const newMetric: NewTrafficMetric = {
        id: "metric-1",
        domainId: "domain-1",
        timestamp: new Date(),
      };

      expect(newMetric.id).toBe("metric-1");
      expect(newMetric.domainId).toBe("domain-1");
      expect(newMetric.timestamp).toBeDefined();
    });

    it("should handle high traffic metrics", () => {
      const highTrafficMetric: Partial<TrafficMetric> = {
        totalRequests: 1000000,
        httpsRequests: 999000,
        httpRequests: 1000,
        status2xx: 950000,
        bytesIn: 5000000000,
        bytesOut: 25000000000,
      };

      expect(highTrafficMetric.totalRequests).toBe(1000000);
      expect(highTrafficMetric.bytesOut).toBe(25000000000);
    });

    it("should handle response code distribution", () => {
      const metric: Partial<TrafficMetric> = {
        status2xx: 8500,
        status3xx: 500,
        status4xx: 800,
        status5xx: 200,
      };

      const total =
        (metric.status2xx || 0) +
        (metric.status3xx || 0) +
        (metric.status4xx || 0) +
        (metric.status5xx || 0);

      expect(total).toBe(10000);
    });

    it("should handle connection statistics", () => {
      const metric: Partial<TrafficMetric> = {
        currentConnections: 250,
        maxConnections: 1000,
      };

      expect(metric.currentConnections).toBeLessThan(metric.maxConnections!);
    });

    it("should handle zero traffic metrics", () => {
      const zeroMetric: Partial<TrafficMetric> = {
        totalRequests: 0,
        httpRequests: 0,
        httpsRequests: 0,
        status2xx: 0,
        status3xx: 0,
        status4xx: 0,
        status5xx: 0,
        bytesIn: 0,
        bytesOut: 0,
        currentConnections: 0,
        maxConnections: 0,
      };

      expect(zeroMetric.totalRequests).toBe(0);
      expect(zeroMetric.bytesOut).toBe(0);
    });

    it("should handle predominantly HTTPS traffic", () => {
      const secureMetric: Partial<TrafficMetric> = {
        totalRequests: 10000,
        httpRequests: 100,
        httpsRequests: 9900,
      };

      const httpsRatio = secureMetric.httpsRequests! / secureMetric.totalRequests!;
      expect(httpsRatio).toBe(0.99);
    });

    it("should handle error-heavy traffic", () => {
      const errorMetric: Partial<TrafficMetric> = {
        totalRequests: 1000,
        status2xx: 200,
        status3xx: 100,
        status4xx: 400,
        status5xx: 300,
      };

      const errorRate =
        (errorMetric.status4xx! + errorMetric.status5xx!) / 1000;
      expect(errorRate).toBe(0.7);
    });
  });
});

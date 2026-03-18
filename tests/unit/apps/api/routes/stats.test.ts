import { describe, it, expect } from "vitest";
import { computeBackendStats } from "../../../../../apps/api/src/routes/stats";

describe("computeBackendStats", () => {
  it("should count all enabled healthy backends as healthy", () => {
    const backends = [
      { enabled: true, isHealthy: true },
      { enabled: true, isHealthy: true },
      { enabled: true, isHealthy: true },
    ];

    const result = computeBackendStats(backends);
    expect(result.total).toBe(3);
    expect(result.healthy).toBe(3);
    expect(result.unhealthy).toBe(0);
  });

  it("should count enabled backend with isHealthy false as unhealthy", () => {
    const backends = [
      { enabled: true, isHealthy: false },
    ];

    const result = computeBackendStats(backends);
    expect(result.total).toBe(1);
    expect(result.healthy).toBe(0);
    expect(result.unhealthy).toBe(1);
  });

  it("should not count disabled backends in healthy or unhealthy", () => {
    const backends = [
      { enabled: false, isHealthy: true },
      { enabled: false, isHealthy: false },
    ];

    const result = computeBackendStats(backends);
    expect(result.total).toBe(2);
    expect(result.healthy).toBe(0);
    expect(result.unhealthy).toBe(0);
  });

  it("should correctly partition a mixed set of backends", () => {
    const backends = [
      { enabled: true, isHealthy: true },
      { enabled: true, isHealthy: false },
      { enabled: false, isHealthy: false },
    ];

    const result = computeBackendStats(backends);
    expect(result.total).toBe(3);
    expect(result.healthy).toBe(1);
    expect(result.unhealthy).toBe(1);
  });

  it("should return zeros for an empty array", () => {
    const result = computeBackendStats([]);
    expect(result.total).toBe(0);
    expect(result.healthy).toBe(0);
    expect(result.unhealthy).toBe(0);
  });

  it("should not count a disabled backend as unhealthy regardless of isHealthy", () => {
    const backends = [
      { enabled: false, isHealthy: true },
    ];

    const result = computeBackendStats(backends);
    expect(result.total).toBe(1);
    expect(result.healthy).toBe(0);
    expect(result.unhealthy).toBe(0);
  });
});

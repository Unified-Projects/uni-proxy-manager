import { beforeEach, describe, expect, it, vi } from "vitest";

const { useQueryMock, getLiveMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn((options: unknown) => options),
  getLiveMock: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: useQueryMock,
}));

vi.mock("@/lib/api", () => ({
  analyticsDataApi: {
    getLive: getLiveMock,
  },
}));

import { analyticsDataKeys, useAnalyticsLive } from "./use-analytics-data";

describe("useAnalyticsLive", () => {
  beforeEach(() => {
    useQueryMock.mockClear();
  });

  it("uses polling by default when a config id is present", () => {
    useAnalyticsLive("cfg-123");

    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: analyticsDataKeys.live("cfg-123"),
        enabled: true,
        refetchInterval: 5000,
      })
    );
  });

  it("allows callers to disable polling while another transport is active", () => {
    useAnalyticsLive("cfg-123", { enabled: false });

    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: analyticsDataKeys.live("cfg-123"),
        enabled: false,
        refetchInterval: 5000,
      })
    );
  });
});

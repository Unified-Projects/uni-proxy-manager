"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Input,
  Label,
} from "@uni-proxy-manager/ui";

export type PeriodKey =
  | "24h"
  | "7d"
  | "30d"
  | "90d"
  | "custom";

export interface DateRange {
  start: string;
  end: string;
}

const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "custom", label: "Custom" },
];

function getDateRangeForPeriod(period: PeriodKey): DateRange {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);

  switch (period) {
    case "24h": {
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      return {
        start: start.toISOString(),
        end: now.toISOString(),
      };
    }
    case "7d": {
      const start = new Date(today);
      start.setDate(start.getDate() - 7);
      return {
        start: start.toISOString(),
        end: endOfDay.toISOString(),
      };
    }
    case "30d": {
      const start = new Date(today);
      start.setDate(start.getDate() - 30);
      return {
        start: start.toISOString(),
        end: endOfDay.toISOString(),
      };
    }
    case "90d": {
      const start = new Date(today);
      start.setDate(start.getDate() - 90);
      return {
        start: start.toISOString(),
        end: endOfDay.toISOString(),
      };
    }
    default:
      return {
        start: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        end: endOfDay.toISOString(),
      };
  }
}

interface PeriodSelectorProps {
  period: PeriodKey;
  onPeriodChange: (period: PeriodKey) => void;
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
}

export function PeriodSelector({
  period,
  onPeriodChange,
  dateRange,
  onDateRangeChange,
}: PeriodSelectorProps) {
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [customOpen, setCustomOpen] = useState(false);

  const handlePeriodChange = (value: string) => {
    const newPeriod = value as PeriodKey;
    onPeriodChange(newPeriod);

    if (newPeriod === "custom") {
      setCustomOpen(true);
      return;
    }

    const range = getDateRangeForPeriod(newPeriod);
    onDateRangeChange(range);
  };

  const handleCustomApply = () => {
    if (customStart && customEnd) {
      onDateRangeChange({
        start: new Date(customStart + "T00:00:00.000Z").toISOString(),
        end: new Date(customEnd + "T23:59:59.999Z").toISOString(),
      });
      setCustomOpen(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <CalendarDays className="h-4 w-4 text-muted-foreground" />
      <Select value={period} onValueChange={handlePeriodChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PERIOD_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {period === "custom" && (
        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              {customStart && customEnd
                ? `${customStart} - ${customEnd}`
                : "Select dates"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            <div className="grid gap-4">
              <div className="space-y-2">
                <h4 className="font-medium leading-none">Custom range</h4>
                <p className="text-sm text-muted-foreground">
                  Select a start and end date for the analytics period.
                </p>
              </div>
              <div className="grid gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="custom-start">Start date</Label>
                  <Input
                    id="custom-start"
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="custom-end">End date</Label>
                  <Input
                    id="custom-end"
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                  />
                </div>
              </div>
              <Button onClick={handleCustomApply} disabled={!customStart || !customEnd}>
                Apply
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export { getDateRangeForPeriod };

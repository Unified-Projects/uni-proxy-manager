"use client";

import { Activity, Users, Shield, CheckCircle, Database } from "lucide-react";
import { Button } from "@uni-proxy-manager/ui";
import type { MetricFilter } from "@/types/metrics";

interface MetricFilterBarProps {
  value: MetricFilter;
  onChange: (filter: MetricFilter) => void;
}

const FILTER_OPTIONS: Array<{
  value: MetricFilter;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "total", label: "Total", icon: Activity },
  { value: "visitors", label: "Visitors", icon: Users },
  { value: "protocol", label: "Protocol", icon: Shield },
  { value: "status", label: "Status", icon: CheckCircle },
  { value: "bandwidth", label: "Bandwidth", icon: Database },
];

export function MetricFilterBar({ value, onChange }: MetricFilterBarProps) {
  return (
    <div className="flex items-center gap-1">
      {FILTER_OPTIONS.map((option) => {
        const Icon = option.icon;
        const isActive = value === option.value;
        return (
          <Button
            key={option.value}
            variant={isActive ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onChange(option.value)}
            className="gap-2"
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{option.label}</span>
          </Button>
        );
      })}
    </div>
  );
}

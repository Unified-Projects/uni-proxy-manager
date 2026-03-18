"use client";

import { useState, useCallback } from "react";
import { X, Filter, ChevronDown } from "lucide-react";
import {
  Badge,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uni-proxy-manager/ui";

/** Filter dimension definitions */
const FILTER_DIMENSIONS = [
  { key: "country", label: "Country", placeholder: "e.g. GB, US, DE" },
  { key: "device", label: "Device type", placeholder: "e.g. desktop, mobile, tablet" },
  { key: "browser", label: "Browser", placeholder: "e.g. Chrome, Firefox, Safari" },
  { key: "os", label: "OS", placeholder: "e.g. Windows, macOS, Linux" },
  { key: "referrer_domain", label: "Referrer domain", placeholder: "e.g. google.com" },
  { key: "utm_source", label: "UTM source", placeholder: "e.g. newsletter" },
  { key: "utm_medium", label: "UTM medium", placeholder: "e.g. email, cpc" },
  { key: "utm_campaign", label: "UTM campaign", placeholder: "e.g. spring-sale" },
  { key: "pathname", label: "Pathname", placeholder: "e.g. /blog, /pricing" },
] as const;

type FilterKey = (typeof FILTER_DIMENSIONS)[number]["key"];

export type AnalyticsFilters = Partial<Record<FilterKey, string>>;

interface FilterBarProps {
  filters: AnalyticsFilters;
  onFiltersChange: (filters: AnalyticsFilters) => void;
}

export function FilterBar({ filters, onFiltersChange }: FilterBarProps) {
  const [addingFilter, setAddingFilter] = useState(false);
  const [selectedDimension, setSelectedDimension] = useState<FilterKey | "">("");
  const [filterValue, setFilterValue] = useState("");

  const activeFilters = Object.entries(filters).filter(
    ([, value]) => value !== undefined && value !== ""
  ) as [FilterKey, string][];

  // Dimensions that have not already been applied
  const availableDimensions = FILTER_DIMENSIONS.filter(
    (d) => !filters[d.key]
  );

  const selectedDimensionDef = FILTER_DIMENSIONS.find(
    (d) => d.key === selectedDimension
  );

  const handleAddFilter = useCallback(() => {
    if (!selectedDimension || !filterValue.trim()) return;

    onFiltersChange({
      ...filters,
      [selectedDimension]: filterValue.trim(),
    });

    setSelectedDimension("");
    setFilterValue("");
    setAddingFilter(false);
  }, [selectedDimension, filterValue, filters, onFiltersChange]);

  const handleRemoveFilter = useCallback(
    (key: FilterKey) => {
      const updated = { ...filters };
      delete updated[key];
      onFiltersChange(updated);
    },
    [filters, onFiltersChange]
  );

  const handleClearAll = useCallback(() => {
    onFiltersChange({});
  }, [onFiltersChange]);

  const getLabelForKey = (key: FilterKey): string => {
    return FILTER_DIMENSIONS.find((d) => d.key === key)?.label ?? key;
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Filter className="h-4 w-4 text-muted-foreground shrink-0" />

      {/* Active filter chips */}
      {activeFilters.map(([key, value]) => (
        <Badge
          key={key}
          variant="secondary"
          className="flex items-center gap-1 pl-2 pr-1 py-1 text-xs"
        >
          <span className="text-muted-foreground">{getLabelForKey(key)}:</span>
          <span className="font-medium">{value}</span>
          <button
            type="button"
            onClick={() => handleRemoveFilter(key)}
            className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
            aria-label={`Remove ${getLabelForKey(key)} filter`}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}

      {/* Add filter popover */}
      {availableDimensions.length > 0 && (
        <Popover open={addingFilter} onOpenChange={setAddingFilter}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
              <Filter className="h-3 w-3" />
              Add filter
              <ChevronDown className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72" align="start">
            <div className="grid gap-3">
              <div className="space-y-1">
                <h4 className="text-sm font-medium leading-none">Add filter</h4>
                <p className="text-xs text-muted-foreground">
                  Filter analytics data by a specific dimension.
                </p>
              </div>
              <div className="grid gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="filter-dimension" className="text-xs">
                    Dimension
                  </Label>
                  <Select
                    value={selectedDimension}
                    onValueChange={(v) => setSelectedDimension(v as FilterKey)}
                  >
                    <SelectTrigger id="filter-dimension" className="h-8 text-xs">
                      <SelectValue placeholder="Select dimension..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableDimensions.map((dim) => (
                        <SelectItem key={dim.key} value={dim.key} className="text-xs">
                          {dim.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedDimension && (
                  <div className="grid gap-1">
                    <Label htmlFor="filter-value" className="text-xs">
                      Value
                    </Label>
                    <Input
                      id="filter-value"
                      className="h-8 text-xs"
                      placeholder={selectedDimensionDef?.placeholder ?? "Enter value..."}
                      value={filterValue}
                      onChange={(e) => setFilterValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddFilter();
                      }}
                    />
                  </div>
                )}
              </div>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={handleAddFilter}
                disabled={!selectedDimension || !filterValue.trim()}
              >
                Apply filter
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Clear all button */}
      {activeFilters.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={handleClearAll}
        >
          Clear all
        </Button>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Plus, Trash2, Eye, EyeOff } from "lucide-react";
import { Button, Input } from "@uni-proxy-manager/ui";

interface EnvVariablesEditorProps {
  variables: Record<string, string>;
  onSave: (variables: Record<string, string>) => void;
  isSaving?: boolean;
}

export function EnvVariablesEditor({
  variables,
  onSave,
  isSaving,
}: EnvVariablesEditorProps) {
  const [entries, setEntries] = useState<Array<{ key: string; value: string }>>(
    Object.entries(variables).map(([key, value]) => ({ key, value }))
  );
  const [showValues, setShowValues] = useState<Record<number, boolean>>({});

  const handleAddEntry = () => {
    setEntries([...entries, { key: "", value: "" }]);
  };

  const handleRemoveEntry = (index: number) => {
    setEntries(entries.filter((_, i) => i !== index));
  };

  const handleKeyChange = (index: number, key: string) => {
    const newEntries = [...entries];
    newEntries[index].key = key;
    setEntries(newEntries);
  };

  const handleValueChange = (index: number, value: string) => {
    const newEntries = [...entries];
    newEntries[index].value = value;
    setEntries(newEntries);
  };

  const toggleShowValue = (index: number) => {
    setShowValues((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const handleSave = () => {
    const vars: Record<string, string> = {};
    for (const entry of entries) {
      if (entry.key.trim()) {
        vars[entry.key.trim()] = entry.value;
      }
    }
    onSave(vars);
  };

  return (
    <div className="space-y-4">
      {entries.length === 0 ? (
        <div className="text-center py-4 text-muted-foreground">
          No environment variables configured
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={entry.key}
                onChange={(e) => handleKeyChange(index, e.target.value)}
                placeholder="VARIABLE_NAME"
                className="flex-1 font-mono"
              />
              <div className="relative flex-1">
                <Input
                  type={showValues[index] ? "text" : "password"}
                  value={entry.value}
                  onChange={(e) => handleValueChange(index, e.target.value)}
                  placeholder="value"
                  className="pr-10 font-mono"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                  onClick={() => toggleShowValue(index)}
                >
                  {showValues[index] ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => handleRemoveEntry(index)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={handleAddEntry}>
          <Plus className="mr-2 h-4 w-4" />
          Add Variable
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Variables"}
        </Button>
      </div>
    </div>
  );
}

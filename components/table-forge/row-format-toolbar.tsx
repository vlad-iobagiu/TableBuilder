"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RowFormat } from "@/lib/types/table";
import { Eraser } from "lucide-react";
import { ColorPicker } from "./color-picker";

interface RowFormatToolbarProps {
  format: RowFormat | undefined;
  onChange: (format: RowFormat) => void;
  disabled?: boolean;
}

/**
 * RowFormatToolbar - Colors applied to a whole row.
 *
 * Row colors act as the row's defaults: any cell that sets its own text or
 * background color overrides them (see `resolveCellColors`).
 */
export function RowFormatToolbar({
  format,
  onChange,
  disabled = false,
}: RowFormatToolbarProps) {
  const hasColors = !!(format?.color || format?.backgroundColor);

  return (
    <div className="flex items-center gap-4 rounded-xl border-2 bg-background/60 p-3 shadow-sm backdrop-blur">
      <ColorPicker
        label="Row text"
        variant="text"
        value={format?.color}
        onChange={(color) => onChange({ ...format, color })}
        disabled={disabled}
        title="Row text color"
      />

      <Separator orientation="vertical" className="h-8 bg-border/50" />

      <ColorPicker
        label="Row fill"
        variant="fill"
        value={format?.backgroundColor}
        onChange={(backgroundColor) => onChange({ ...format, backgroundColor })}
        disabled={disabled}
        title="Row background color"
      />

      <Separator orientation="vertical" className="h-8 bg-border/50" />

      <Button
        size="sm"
        variant="ghost"
        className="h-8 px-3 text-xs hover:bg-background"
        onClick={() => onChange({})}
        disabled={disabled || !hasColors}
        title="Clear row colors"
      >
        <Eraser className="mr-1.5 h-3.5 w-3.5" />
        Clear
      </Button>

      <span className="ml-auto text-[11px] text-muted-foreground">
        Cell colors override row colors
      </span>
    </div>
  );
}

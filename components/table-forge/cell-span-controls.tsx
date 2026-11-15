"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Minus, Plus, Split, TableColumnsSplit } from "lucide-react";

interface CellSpanControlsProps {
  colSpan: number;
  rowSpan: number;
  /** Columns available from this cell to the right edge of the table */
  maxColSpan: number;
  /** Rows available from this cell to the bottom of the table */
  maxRowSpan: number;
  /** Whether the given span is free of collisions with other merged cells */
  canSpan: (colSpan: number, rowSpan: number) => boolean;
  onChange: (colSpan: number, rowSpan: number) => void;
  disabled?: boolean;
}

/**
 * CellSpanControls - Merge a cell across columns and/or down rows.
 *
 * Merging is expressed as the anchor cell's colspan/rowspan; the cells it
 * covers keep their data but stop being rendered, so unmerging restores them.
 */
export function CellSpanControls({
  colSpan,
  rowSpan,
  maxColSpan,
  maxRowSpan,
  canSpan,
  onChange,
  disabled = false,
}: CellSpanControlsProps) {
  const isMerged = colSpan > 1 || rowSpan > 1;
  const canSpanFullRow = canSpan(maxColSpan, rowSpan);

  const stepper = (
    label: string,
    unit: string,
    value: number,
    max: number,
    /** Builds the full span pair for a candidate value, so it can be validated */
    spanFor: (next: number) => [number, number],
    apply: (next: number) => void
  ) => {
    const canDecrease = value > 1;
    const canIncrease = value < max && canSpan(...spanFor(value + 1));

    return (
      <div className="flex items-center gap-2">
        <span className="mr-1 text-xs font-bold uppercase tracking-wide text-foreground/70">
          {label}
        </span>
        <div className="flex items-center gap-1 rounded-lg bg-muted/40 p-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 transition-all hover:bg-background"
            onClick={() => apply(value - 1)}
            disabled={disabled || !canDecrease}
            title={`Merge one fewer ${unit}`}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="min-w-[28px] text-center text-xs font-bold">
            {value}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 transition-all hover:bg-background"
            onClick={() => apply(value + 1)}
            disabled={disabled || !canIncrease}
            title={`Merge one more ${unit}`}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border-2 bg-background/60 p-3 shadow-sm backdrop-blur">
      {stepper(
        "Cols",
        "column",
        colSpan,
        maxColSpan,
        (next) => [next, rowSpan],
        (next) => onChange(next, rowSpan)
      )}

      <Separator orientation="vertical" className="h-8 bg-border/50" />

      {stepper(
        "Rows",
        "row",
        rowSpan,
        maxRowSpan,
        (next) => [colSpan, next],
        (next) => onChange(colSpan, next)
      )}

      <Separator orientation="vertical" className="h-8 bg-border/50" />

      <Button
        size="sm"
        variant="ghost"
        className="h-8 px-3 text-xs hover:bg-background"
        onClick={() => onChange(maxColSpan, rowSpan)}
        disabled={disabled || !canSpanFullRow || colSpan === maxColSpan}
        title="Merge this cell across the remaining columns"
      >
        <TableColumnsSplit className="mr-1.5 h-3.5 w-3.5" />
        Span full width
      </Button>

      <Button
        size="sm"
        variant="ghost"
        className="h-8 px-3 text-xs hover:bg-background"
        onClick={() => onChange(1, 1)}
        disabled={disabled || !isMerged}
        title="Split this cell back into single cells"
      >
        <Split className="mr-1.5 h-3.5 w-3.5" />
        Unmerge
      </Button>

      <span className="ml-auto text-[11px] text-muted-foreground">
        {isMerged
          ? `Merged ${colSpan} × ${rowSpan} — hidden cells keep their content`
          : "Merge this cell across columns or rows"}
      </span>
    </div>
  );
}

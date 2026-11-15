/**
 * Legacy "dynamic table" migration.
 *
 * The old table format stored data as child Sitecore items rather than a JSON
 * field value:
 *
 *   InstallationTable
 *     ├─ row_00
 *     │    ├─ column_00   (Content field = cell text/HTML)
 *     │    └─ column_01   (Content field = cell text/HTML)
 *     ├─ row_01
 *     │    ├─ column_00
 *     │    └─ column_01
 *     └─ ...
 *
 * When the new Grid Composer field is empty, the item is still on the old
 * format. Read those row/column items, shape them into `LegacyRowItem[]`, and
 * pass them here to get a `TableData` that serializes to the current JSON
 * format (see lib/types/table.ts).
 */

import {
  TableData,
  TableColumn,
  TableRow,
  TableCell,
  CellFormat,
} from "./types/table";

/** A legacy `column_NN` item: its name (for ordering) and its Content value. */
export interface LegacyColumnItem {
  /** Item name, e.g. "column_00" — used to order cells within the row. */
  name: string;
  /** Value of the column item's Content field (plain text or HTML). */
  content: string;
}

/** A legacy `row_NN` item with its column children. */
export interface LegacyRowItem {
  /** Item name, e.g. "row_00" — used to order rows. */
  name: string;
  /** The column child items belonging to this row. */
  columns: LegacyColumnItem[];
}

export interface LegacyConversionOptions {
  /** Treat the first row as a (bold) header row. Defaults to true. */
  firstRowIsHeader?: boolean;
}

/**
 * Order items like "row_00", "row_10", "column_2" by their trailing number when
 * present, falling back to a locale-aware name compare. This keeps row_10 after
 * row_2 (numeric), which a plain string sort would get wrong.
 */
function compareByTrailingNumber(a: string, b: string): number {
  const numA = a.match(/(\d+)\s*$/);
  const numB = b.match(/(\d+)\s*$/);
  if (numA && numB) {
    const diff = parseInt(numA[1], 10) - parseInt(numB[1], 10);
    if (diff !== 0) return diff;
  }
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function makeFormat(isHeader: boolean): CellFormat {
  return {
    align: "left",
    verticalAlign: "middle",
    fontWeight: isHeader ? "bold" : "normal",
    wrap: true,
  };
}

function makeCell(content: string, isHeader: boolean): TableCell {
  return {
    id: crypto.randomUUID(),
    content: content ?? "",
    format: makeFormat(isHeader),
  };
}

/**
 * Convert legacy row/column items into the current TableData structure.
 *
 * - Rows and columns are sorted by their item names (numeric-aware).
 * - The table width is the maximum column count across all rows; shorter rows
 *   are padded with empty cells so every row matches the column count (which the
 *   TableData validator requires).
 * - The first row is marked as a bold header by default (see options).
 */
export function convertLegacyTableToTableData(
  rows: LegacyRowItem[],
  options: LegacyConversionOptions = {}
): TableData {
  const firstRowIsHeader = options.firstRowIsHeader ?? true;

  // Order rows, and order each row's columns, by name.
  const orderedRows = [...rows]
    .sort((a, b) => compareByTrailingNumber(a.name, b.name))
    .map((row) => ({
      name: row.name,
      contents: [...row.columns]
        .sort((a, b) => compareByTrailingNumber(a.name, b.name))
        .map((col) => col.content ?? ""),
    }));

  // The table is as wide as its widest row.
  const columnCount = orderedRows.reduce(
    (max, row) => Math.max(max, row.contents.length),
    0
  );

  const columns: TableColumn[] = Array.from(
    { length: columnCount },
    (): TableColumn => ({ id: crypto.randomUUID(), width: "auto" })
  );

  const tableRows: TableRow[] = orderedRows.map((row, rowIndex) => {
    const isHeader = firstRowIsHeader && rowIndex === 0;
    const cells: TableCell[] = Array.from({ length: columnCount }, (_, i) =>
      makeCell(row.contents[i] ?? "", isHeader)
    );
    return {
      id: crypto.randomUUID(),
      isHeader,
      cells,
    };
  });

  const now = new Date().toISOString();

  return {
    version: "1.0",
    columns,
    rows: tableRows,
    settings: {
      hasHeaderRow: firstRowIsHeader && tableRows.length > 0,
      hasBorders: true,
      isStriped: false,
      defaultCellFormat: {
        align: "left",
        verticalAlign: "middle",
        fontWeight: "normal",
        wrap: true,
      },
    },
    metadata: {
      created: now,
      modified: now,
    },
  };
}

/**
 * Convenience overload: convert a plain 2D array of cell strings (already
 * ordered: rows[rowIndex][columnIndex]) into TableData.
 */
export function convertLegacyRowsFromStrings(
  rows: string[][],
  options: LegacyConversionOptions = {}
): TableData {
  const legacyRows: LegacyRowItem[] = rows.map((cells, rowIndex) => ({
    name: `row_${String(rowIndex).padStart(2, "0")}`,
    columns: cells.map((content, colIndex) => ({
      name: `column_${String(colIndex).padStart(2, "0")}`,
      content,
    })),
  }));
  return convertLegacyTableToTableData(legacyRows, options);
}

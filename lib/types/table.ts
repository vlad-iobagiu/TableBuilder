/**
 * Grid Composer Data Structure
 *
 * This defines the core data structure for tables created in Grid Composer.
 * The structure is designed to be clean, JSON-serializable, and easy to
 * consume by rendering components.
 */

/**
 * Text alignment options for table cells
 */
export type CellAlignment = 'left' | 'center' | 'right';

/**
 * Vertical alignment options for table cells
 */
export type CellVerticalAlignment = 'top' | 'middle' | 'bottom';

/**
 * Font weight options for cell content
 */
export type FontWeight = 'normal' | 'medium' | 'semibold' | 'bold';

/**
 * Cell formatting metadata
 */
export interface CellFormat {
  /** Horizontal text alignment */
  align?: CellAlignment;
  /** Vertical text alignment */
  verticalAlign?: CellVerticalAlignment;
  /** Font weight */
  fontWeight?: FontWeight;
  /** Text color (hex or CSS color name) */
  color?: string;
  /** Background color (hex or CSS color name) */
  backgroundColor?: string;
  /** Whether text should wrap */
  wrap?: boolean;
}

/**
 * Row-level formatting metadata.
 *
 * These act as defaults for every cell in the row; a cell's own `CellFormat`
 * always wins when it sets the same property (see `resolveCellColors`).
 */
export interface RowFormat {
  /** Text color for the whole row (hex or CSS color name) */
  color?: string;
  /** Background color for the whole row (hex or CSS color name) */
  backgroundColor?: string;
}

/**
 * Hyperlink metadata for a cell.
 * When present, the cell's content should render as a link to `url`.
 */
export interface CellLink {
  /** Destination URL (required for the link to be active) */
  url: string;
  /** Optional display text. When empty, the cell content is used as the link text */
  label?: string;
  /** Open the link in a new browser tab (target="_blank") */
  openInNewTab?: boolean;
  /** Optional title/tooltip text (title attribute) */
  title?: string;
}

/**
 * Represents a single cell in the table
 */
export interface TableCell {
  /**
   * Cell content as an inline HTML string.
   * May contain text mixed with a small set of inline tags, e.g.
   * `mytext <a href="#link">text</a>`. MUST be sanitized before rendering
   * (see lib/sanitize.ts).
   */
  content: string;
  /** Optional formatting for this cell */
  format?: CellFormat;
  /** Cell ID for tracking (generated UUID) */
  id: string;
  /**
   * Number of columns this cell spans (HTML `colspan`). Omitted or 1 = no span.
   * Cells covered by the span stay in `TableRow.cells` (so every row keeps one
   * entry per column) but must not be rendered — see `computeCoveredCells`.
   */
  colSpan?: number;
  /** Number of rows this cell spans (HTML `rowspan`). Omitted or 1 = no span. */
  rowSpan?: number;
}

/**
 * Represents a row in the table
 */
export interface TableRow {
  /** Array of cells in this row */
  cells: TableCell[];
  /** Row ID for tracking (generated UUID) */
  id: string;
  /** Whether this row is a header row */
  isHeader?: boolean;
  /** Optional colors applied to every cell in this row unless the cell overrides them */
  format?: RowFormat;
}

/**
 * Resolves the effective text/background color for a cell.
 *
 * Precedence: the cell's own format wins, otherwise the row's format applies.
 * Returns `undefined` for a color that is set in neither, so callers can leave
 * the corresponding CSS property off entirely.
 */
export function resolveCellColors(
  cellFormat: CellFormat | undefined,
  rowFormat: RowFormat | undefined
): { color?: string; backgroundColor?: string } {
  return {
    color: cellFormat?.color ?? rowFormat?.color,
    backgroundColor: cellFormat?.backgroundColor ?? rowFormat?.backgroundColor,
  };
}

/**
 * Column metadata
 */
export interface TableColumn {
  /** Column ID for tracking (generated UUID) */
  id: string;
  /** Optional column label/name */
  label?: string;
  /** Optional default width (CSS value like "200px" or "auto") */
  width?: string;
}

/**
 * Main table data structure
 * This is what gets serialized to JSON and saved to the Sitecore field
 */
export interface TableData {
  /** Version of the data structure (for future migrations) */
  version: string;
  /** Array of rows in the table */
  rows: TableRow[];
  /** Array of column metadata */
  columns: TableColumn[];
  /** Global table settings */
  settings?: {
    /** Whether the first row should be treated as a header */
    hasHeaderRow?: boolean;
    /** Default cell format applied to all cells unless overridden */
    defaultCellFormat?: CellFormat;
    /** Table caption/title */
    caption?: string;
    /** Whether table has borders */
    hasBorders?: boolean;
    /** Whether table should be striped (alternating row colors) */
    isStriped?: boolean;
  };
  /** Metadata about when/who created/modified the table */
  metadata?: {
    created?: string; // ISO date string
    modified?: string; // ISO date string
    createdBy?: string;
    modifiedBy?: string;
  };
}

/**
 * Reads a cell's spans, coercing missing/invalid values to 1.
 */
export function getCellSpan(cell: TableCell | undefined): {
  colSpan: number;
  rowSpan: number;
} {
  return {
    colSpan: Math.max(1, Math.floor(cell?.colSpan ?? 1)),
    rowSpan: Math.max(1, Math.floor(cell?.rowSpan ?? 1)),
  };
}

/**
 * Marks every grid position that is hidden behind another cell's colspan/rowspan.
 *
 * Merged cells keep their placeholders in `row.cells` so the grid stays
 * rectangular; renderers use this map to skip the placeholders. A placeholder
 * that itself declares a span is ignored (spans never nest).
 */
export function computeCoveredCells(
  rows: TableRow[],
  columnCount: number
): boolean[][] {
  const covered: boolean[][] = rows.map(() =>
    new Array<boolean>(columnCount).fill(false)
  );

  rows.forEach((row, rowIndex) => {
    for (let colIndex = 0; colIndex < columnCount; colIndex++) {
      if (covered[rowIndex][colIndex]) continue;

      const { colSpan, rowSpan } = getCellSpan(row.cells[colIndex]);
      if (colSpan === 1 && rowSpan === 1) continue;

      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < colSpan; dc++) {
          if (dr === 0 && dc === 0) continue;
          const r = rowIndex + dr;
          const c = colIndex + dc;
          if (r < rows.length && c < columnCount) covered[r][c] = true;
        }
      }
    }
  });

  return covered;
}

/**
 * Whether a cell can be resized to the given span without running past the
 * table edge or colliding with another merged cell.
 */
export function canSpanCell(
  rows: TableRow[],
  columnCount: number,
  rowIndex: number,
  cellIndex: number,
  colSpan: number,
  rowSpan: number
): boolean {
  if (colSpan < 1 || rowSpan < 1) return false;
  if (rowIndex + rowSpan > rows.length) return false;
  if (cellIndex + colSpan > columnCount) return false;

  // Coverage as it would be with this cell reset to 1×1, so the cell's own
  // current span never counts as a collision with itself.
  const probeRows = rows.map((row, r) =>
    r !== rowIndex
      ? row
      : {
          ...row,
          cells: row.cells.map((cell, c) =>
            c !== cellIndex ? cell : { ...cell, colSpan: 1, rowSpan: 1 }
          ),
        }
  );
  const covered = computeCoveredCells(probeRows, columnCount);

  for (let r = rowIndex; r < rowIndex + rowSpan; r++) {
    for (let c = cellIndex; c < cellIndex + colSpan; c++) {
      if (r === rowIndex && c === cellIndex) continue;
      if (covered[r][c]) return false;
      const { colSpan: otherCols, rowSpan: otherRows } = getCellSpan(
        probeRows[r].cells[c]
      );
      if (otherCols > 1 || otherRows > 1) return false;
    }
  }

  return true;
}

/**
 * Clamps every span to the current table bounds and trims any that overlap.
 *
 * Adding, removing and reordering rows/columns can leave spans pointing past
 * the edge of the table or on top of each other; run this after any structural
 * change so the grid stays renderable.
 */
export function normalizeTableSpans(data: TableData): TableData {
  const columnCount = data.columns.length;
  const rowCount = data.rows.length;

  const covered: boolean[][] = data.rows.map(() =>
    new Array<boolean>(columnCount).fill(false)
  );
  const rows = data.rows.map((row) => ({ ...row, cells: [...row.cells] }));

  const setSpan = (r: number, c: number, colSpan: number, rowSpan: number) => {
    const cell = rows[r].cells[c];
    if (!cell) return;
    rows[r].cells[c] = {
      ...cell,
      colSpan: colSpan > 1 ? colSpan : undefined,
      rowSpan: rowSpan > 1 ? rowSpan : undefined,
    };
  };

  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < columnCount; c++) {
      const cell = rows[r].cells[c];
      if (!cell) continue;

      // Anything hidden behind an earlier span cannot carry a span of its own
      if (covered[r][c]) {
        setSpan(r, c, 1, 1);
        continue;
      }

      const requested = getCellSpan(cell);
      let colSpan = Math.min(requested.colSpan, columnCount - c);
      let rowSpan = Math.min(requested.rowSpan, rowCount - r);

      // Stop at the first column already taken by an earlier span
      for (let dc = 1; dc < colSpan; dc++) {
        if (covered[r][c + dc]) {
          colSpan = dc;
          break;
        }
      }
      // Then at the first row where any of those columns is taken
      for (let dr = 1; dr < rowSpan; dr++) {
        let blocked = false;
        for (let dc = 0; dc < colSpan; dc++) {
          if (covered[r + dr][c + dc]) {
            blocked = true;
            break;
          }
        }
        if (blocked) {
          rowSpan = dr;
          break;
        }
      }

      setSpan(r, c, colSpan, rowSpan);

      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < colSpan; dc++) {
          if (dr === 0 && dc === 0) continue;
          covered[r + dr][c + dc] = true;
        }
      }
    }
  }

  return { ...data, rows };
}

/**
 * Creates an empty cell with default values
 */
export function createEmptyCell(): TableCell {
  return {
    id: crypto.randomUUID(),
    content: '',
    format: {
      align: 'left',
      verticalAlign: 'middle',
      fontWeight: 'normal',
      wrap: true,
    },
  };
}

/**
 * Creates an empty row with specified number of columns
 */
export function createEmptyRow(columnCount: number, isHeader = false): TableRow {
  return {
    id: crypto.randomUUID(),
    isHeader,
    cells: Array.from({ length: columnCount }, () => createEmptyCell()),
  };
}

/**
 * Creates an empty column
 */
export function createEmptyColumn(): TableColumn {
  return {
    id: crypto.randomUUID(),
    width: 'auto',
  };
}

/**
 * Creates a new empty table with specified dimensions
 */
export function createEmptyTable(rows = 3, columns = 3, hasHeaderRow = true): TableData {
  const tableColumns = Array.from({ length: columns }, () => createEmptyColumn());
  const tableRows = Array.from({ length: rows }, (_, index) =>
    createEmptyRow(columns, hasHeaderRow && index === 0)
  );

  return {
    version: '1.0',
    columns: tableColumns,
    rows: tableRows,
    settings: {
      hasHeaderRow,
      hasBorders: true,
      isStriped: false,
      defaultCellFormat: {
        align: 'left',
        verticalAlign: 'middle',
        fontWeight: 'normal',
        wrap: true,
      },
    },
    metadata: {
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    },
  };
}

/**
 * Validates that a TableData object has the correct structure
 */
export function validateTableData(data: unknown): data is TableData {
  if (!data || typeof data !== 'object') return false;

  const table = data as TableData;

  // Check required fields
  if (!table.version || !Array.isArray(table.rows) || !Array.isArray(table.columns)) {
    return false;
  }

  // Validate rows
  for (const row of table.rows) {
    if (!row.id || !Array.isArray(row.cells)) return false;
    if (row.cells.length !== table.columns.length) return false;

    // Validate cells
    for (const cell of row.cells) {
      if (!cell.id || typeof cell.content !== 'string') return false;
    }
  }

  // Validate columns
  for (const column of table.columns) {
    if (!column.id) return false;
  }

  return true;
}

/**
 * Parses JSON string into TableData, with validation
 */
export function parseTableData(json: string): TableData | null {
  try {
    const parsed = JSON.parse(json);
    if (validateTableData(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Serializes TableData to JSON string
 */
export function serializeTableData(data: TableData): string {
  // Update modified timestamp
  const updatedData = {
    ...data,
    metadata: {
      ...data.metadata,
      modified: new Date().toISOString(),
    },
  };

  return JSON.stringify(updatedData, null, 2);
}

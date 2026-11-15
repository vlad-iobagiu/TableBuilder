"use client";

import React, { useState, useRef, useEffect } from "react";
import { CellFormat, RowFormat, resolveCellColors } from "@/lib/types/table";
import { sanitizeHtml, htmlToPlainText } from "@/lib/sanitize";

interface EditableCellProps {
  value: string;
  onChange: (value: string) => void;
  isHeader?: boolean;
  format?: CellFormat;
  /** Colors inherited from the row; the cell's own format takes precedence */
  rowFormat?: RowFormat;
}

/**
 * EditableCell - Inline editable table cell holding raw inline HTML.
 *
 * Editing: a textarea where you type/paste HTML (e.g. `mytext <a href="#l">t</a>`).
 * Display: the HTML is sanitized (lib/sanitize.ts) and rendered.
 * - Press Ctrl/Cmd+Enter to finish editing
 * - Press Escape to cancel
 */
export function EditableCell({
  value,
  onChange,
  isHeader = false,
  format,
  rowFormat,
}: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Sanitized HTML can only be produced in the browser; render after mount
  // to avoid hydration mismatches.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Update edit value when prop value changes
  useEffect(() => {
    if (!isEditing) {
      setEditValue(value);
    }
  }, [value, isEditing]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  /**
   * Start editing mode
   */
  const handleStartEdit = () => {
    setIsEditing(true);
    setEditValue(value);
  };

  /**
   * Finish editing and save changes
   */
  const handleFinishEdit = () => {
    setIsEditing(false);
    if (editValue !== value) {
      onChange(editValue);
    }
  };

  /**
   * Cancel editing and revert changes
   */
  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue(value);
  };

  /**
   * Handle keyboard shortcuts
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd+Enter finishes editing (plain Enter inserts a newline)
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleFinishEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  /**
   * Handle blur (clicking outside)
   */
  const handleBlur = () => {
    handleFinishEdit();
  };

  /**
   * Get cell styles based on format
   */
  const getCellStyles = (): React.CSSProperties => {
    const styles: React.CSSProperties = {
      padding: "8px 12px",
      minHeight: "40px",
      width: "100%",
      display: "flex",
      alignItems:
        format?.verticalAlign === "top"
          ? "flex-start"
          : format?.verticalAlign === "bottom"
          ? "flex-end"
          : "center",
    };

    if (format?.align) {
      styles.justifyContent =
        format.align === "left"
          ? "flex-start"
          : format.align === "right"
          ? "flex-end"
          : "center";
    }

    if (format?.fontWeight) {
      const fontWeightMap = {
        normal: 400,
        medium: 500,
        semibold: 600,
        bold: 700,
      };
      styles.fontWeight = fontWeightMap[format.fontWeight];
    }

    // Cell colors win; otherwise fall back to the row's colors
    const { color, backgroundColor } = resolveCellColors(format, rowFormat);

    if (color) {
      styles.color = color;
    }

    if (backgroundColor) {
      styles.backgroundColor = backgroundColor;
    }

    return styles;
  };

  /**
   * Get input styles to match display styles
   */
  const getInputStyles = (): React.CSSProperties => {
    const styles: React.CSSProperties = {
      width: "100%",
      minHeight: "72px",
      padding: "8px 12px",
      border: "2px solid hsl(var(--primary))",
      borderRadius: "4px",
      outline: "none",
      fontSize: "0.8125rem",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      backgroundColor: "white",
      resize: "vertical",
      lineHeight: 1.5,
    };

    return styles;
  };

  if (isEditing) {
    return (
      <div className="p-0 animate-in fade-in duration-150">
        <textarea
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          style={getInputStyles()}
          spellCheck={false}
          placeholder={`Type text and inline HTML, e.g.\nmytext <a href="#link">text</a>`}
          className="focus:ring-2 focus:ring-primary focus:ring-offset-1 shadow-lg"
        />
        <div className="px-1 pt-1 text-[10px] text-muted-foreground">
          Supports inline HTML (links, bold, italic…). Ctrl/Cmd+Enter to save,
          Esc to cancel.
        </div>
      </div>
    );
  }

  const isEmpty = !value || htmlToPlainText(value).length === 0;
  const safeHtml = mounted ? sanitizeHtml(value) : "";

  return (
    <div
      onClick={handleStartEdit}
      style={getCellStyles()}
      className={`
        cursor-text
        hover:bg-primary/5
        transition-all
        duration-150
        group
        cell-html
        ${isHeader ? "font-semibold" : ""}
        ${isEmpty ? "text-muted-foreground/60 italic" : ""}
      `}
      title="Click to edit"
    >
      {isEmpty ? (
        <span className="group-hover:text-muted-foreground transition-colors">
          Click to edit...
        </span>
      ) : mounted ? (
        // Sanitized before rendering — see lib/sanitize.ts
        <span dangerouslySetInnerHTML={{ __html: safeHtml }} />
      ) : (
        // Pre-hydration fallback: plain text only (no HTML)
        <span>{htmlToPlainText(value)}</span>
      )}
    </div>
  );
}

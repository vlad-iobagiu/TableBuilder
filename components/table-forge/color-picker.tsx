"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ban, Check } from "lucide-react";

/**
 * Preset swatches offered by the picker.
 * Two rows: neutrals on top, saturated hues below (light → dark per hue).
 */
export const COLOR_PRESETS: { name: string; value: string }[] = [
  { name: "White", value: "#ffffff" },
  { name: "Light gray", value: "#f2f2f2" },
  { name: "Gray", value: "#d9d9d9" },
  { name: "Mid gray", value: "#a6a6a6" },
  { name: "Dark gray", value: "#595959" },
  { name: "Black", value: "#000000" },
  { name: "Pale blue", value: "#dbeeff" },
  { name: "Light blue", value: "#4aa3f0" },
  { name: "Blue", value: "#0072c6" },
  { name: "Navy", value: "#1f3864" },

  { name: "Pale green", value: "#d9ead3" },
  { name: "Light green", value: "#93c47d" },
  { name: "Green", value: "#38a169" },
  { name: "Dark green", value: "#1e6b3f" },
  { name: "Yellow", value: "#ffe599" },
  { name: "Amber", value: "#f6b26b" },
  { name: "Orange", value: "#e26e00" },
  { name: "Red", value: "#d92739" },
  { name: "Purple", value: "#6e3fff" },
  { name: "Teal", value: "#007c85" },
];

/** Accepts #rgb / #rrggbb, plus CSS color names / functional notations. */
function isValidColor(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) return true;
  // Fall back to the browser's own parser for names like "tomato" or rgb()/hsl().
  if (typeof CSS !== "undefined" && CSS.supports) {
    return CSS.supports("color", trimmed);
  }
  return false;
}

/** `<input type="color">` only accepts #rrggbb — expand shorthand, else fall back. */
function toHexInputValue(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

interface ColorPickerProps {
  /** Short label shown next to the swatch (omitted in `compact` mode) */
  label?: string;
  /** Current color, or undefined when unset */
  value?: string;
  /** Called with the new color, or `undefined` when cleared */
  onChange: (color: string | undefined) => void;
  /** `text` renders an "A" over the swatch, `fill` a solid block */
  variant?: "text" | "fill";
  /** Render only the swatch button (for tight spaces like the row controls) */
  compact?: boolean;
  disabled?: boolean;
  title?: string;
}

/**
 * ColorPicker - Swatch button that opens a preset palette + custom color input.
 *
 * The popover is rendered through a portal so it escapes the table's
 * `overflow-auto` container instead of being clipped by it.
 */
export function ColorPicker({
  label,
  value,
  onChange,
  variant = "fill",
  compact = false,
  disabled = false,
  title,
}: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null
  );
  const [customValue, setCustomValue] = useState(value ?? "");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const PANEL_WIDTH = 232;

  // Keep the free-text field in sync when the color changes from elsewhere
  useEffect(() => {
    setCustomValue(value ?? "");
  }, [value]);

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - PANEL_WIDTH - 8)
    );
    setPosition({ top: rect.bottom + 6, left });
  }, []);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  // Close on outside click / Escape, and follow the trigger while scrolling
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  const handleSelect = (color: string | undefined) => {
    onChange(color);
    setOpen(false);
  };

  const handleCustomCommit = () => {
    const trimmed = customValue.trim();
    if (!trimmed) {
      onChange(undefined);
      return;
    }
    if (isValidColor(trimmed)) {
      onChange(trimmed);
    } else {
      // Reject the entry and restore the last good value
      setCustomValue(value ?? "");
    }
  };

  const swatchStyle: React.CSSProperties = value
    ? { backgroundColor: value }
    : {
        // Diagonal stripe = "no color set"
        backgroundImage:
          "linear-gradient(45deg, transparent 45%, var(--color-danger-400) 45%, var(--color-danger-400) 55%, transparent 55%)",
        backgroundColor: "var(--background)",
      };

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        setOpen((prev) => !prev);
      }}
      title={title ?? (variant === "text" ? "Text color" : "Background color")}
      className={`flex items-center justify-center rounded-md border-2 transition-all hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 ${
        compact ? "h-6 w-6" : "h-8 w-8"
      } ${open ? "border-primary shadow-md" : "border-border hover:border-primary/60"}`}
    >
      {variant === "text" ? (
        <span className="flex flex-col items-center leading-none">
          <span className={compact ? "text-[9px] font-bold" : "text-[11px] font-bold"}>
            A
          </span>
          <span
            className="mt-0.5 block w-3.5 rounded-sm border border-black/10"
            style={{ height: compact ? 3 : 4, ...swatchStyle }}
          />
        </span>
      ) : (
        <span
          className="block rounded-sm border border-black/10"
          style={{ height: compact ? 14 : 18, width: compact ? 14 : 18, ...swatchStyle }}
        />
      )}
    </button>
  );

  const panel =
    open && position
      ? createPortal(
          <div
            ref={panelRef}
            onClick={(event) => event.stopPropagation()}
            style={{ top: position.top, left: position.left, width: PANEL_WIDTH }}
            className="fixed z-50 rounded-xl border-2 bg-popover p-3 shadow-xl animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="mb-2 grid grid-cols-10 gap-1">
              {COLOR_PRESETS.map((preset) => {
                const isActive =
                  value?.toLowerCase() === preset.value.toLowerCase();
                return (
                  <button
                    key={preset.value}
                    type="button"
                    title={preset.name}
                    onClick={() => handleSelect(preset.value)}
                    className={`flex h-5 w-5 items-center justify-center rounded border transition-transform hover:scale-125 ${
                      isActive ? "border-primary ring-1 ring-primary" : "border-black/15"
                    }`}
                    style={{ backgroundColor: preset.value }}
                  >
                    {isActive && (
                      <Check
                        className="h-3 w-3"
                        style={{ color: preset.value === "#ffffff" ? "#000" : "#fff" }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 border-t pt-2">
              <input
                type="color"
                aria-label="Custom color"
                value={toHexInputValue(value, "#000000")}
                onChange={(event) => onChange(event.target.value)}
                className="h-7 w-9 cursor-pointer rounded border bg-transparent p-0.5"
              />
              <input
                type="text"
                aria-label="Color value"
                value={customValue}
                placeholder="#rrggbb"
                spellCheck={false}
                onChange={(event) => setCustomValue(event.target.value)}
                onBlur={handleCustomCommit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleCustomCommit();
                    setOpen(false);
                  }
                }}
                className="h-7 min-w-0 flex-1 rounded border bg-background px-2 font-mono text-xs outline-none focus:border-primary"
              />
            </div>

            <button
              type="button"
              onClick={() => handleSelect(undefined)}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
            >
              <Ban className="h-3 w-3" />
              No color
            </button>
          </div>,
          document.body
        )
      : null;

  if (compact) {
    return (
      <>
        {trigger}
        {panel}
      </>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {label && (
        <span className="mr-1 text-xs font-bold uppercase tracking-wide text-foreground/70">
          {label}
        </span>
      )}
      {trigger}
      {panel}
    </div>
  );
}

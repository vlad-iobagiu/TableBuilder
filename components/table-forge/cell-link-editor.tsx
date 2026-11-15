"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Link2,
  ExternalLink,
  FolderTree,
  FileDown,
  FileText,
  X,
} from "lucide-react";
import { InternalLinkPicker } from "./internal-link-picker";
import type { PickerKind, SelectedInternalPage } from "@/lib/sitecore-pages";
import { buildItemHref } from "@/lib/item-id";

interface CellLinkEditorProps {
  /** Called with an anchor HTML string to insert into the cell content */
  onInsert: (anchorHtml: string) => void;
  disabled?: boolean;
}

/** Escape a string for safe use inside an HTML attribute value */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape a string for safe use as HTML text content */
function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * CellLinkEditor - Builds an anchor tag and inserts it into a cell's HTML content.
 *
 * Cells store raw inline HTML, so this is a convenience helper: fill in the
 * fields, click "Insert link", and an <a> tag is appended to the selected
 * cell's content (which you can then reorder/edit as raw HTML).
 *
 * Two buttons open the Sitecore tree instead of typing a URL by hand: one for
 * pages and one for media library files such as PDFs. In both cases the item's
 * URL lands in the URL field, and its name in the link text when that is still
 * empty.
 */
export function CellLinkEditor({
  onInsert,
  disabled = false,
}: CellLinkEditorProps) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [title, setTitle] = useState("");
  const [openInNewTab, setOpenInNewTab] = useState(false);

  // Item picked through a Sitecore tree (null = external or typed URL)
  const [picked, setPicked] = useState<SelectedInternalPage | null>(null);
  // Which tree is open, if any
  const [pickerMode, setPickerMode] = useState<PickerKind | null>(null);

  const canInsert = url.trim().length > 0;

  const handleInsert = () => {
    if (!canInsert) return;

    const attrs = [`href="${escapeAttr(url.trim())}"`];
    if (title.trim()) attrs.push(`title="${escapeAttr(title.trim())}"`);
    if (openInNewTab) {
      attrs.push(`target="_blank"`);
      attrs.push(`rel="noopener noreferrer"`);
    }

    const text = escapeText(label.trim() || url.trim());
    const anchor = `<a ${attrs.join(" ")}>${text}</a>`;

    onInsert(anchor);

    // Reset the form for the next link
    setUrl("");
    setLabel("");
    setTitle("");
    setOpenInNewTab(false);
    setPicked(null);
  };

  /**
   * An item was picked in a Sitecore tree: use its URL and, when the link text
   * is still empty, its display name. Files default to opening in a new tab.
   */
  const handlePicked = (item: SelectedInternalPage) => {
    setPicked(item);
    setUrl(buildItemHref(item.id, item.kind));
    if (!label.trim()) setLabel(item.displayName);
    if (item.kind === "media") setOpenInNewTab(true);
    setPickerMode(null);
  };

  const clearPicked = () => {
    setPicked(null);
    setUrl("");
  };

  const handleUrlChange = (value: string) => {
    setUrl(value);
    // Editing the URL by hand turns it back into a plain link
    if (picked && value !== buildItemHref(picked.id, picked.kind)) {
      setPicked(null);
    }
  };

  const inputClass =
    "w-full h-9 px-3 rounded-lg border-2 bg-background text-sm outline-none " +
    "focus:ring-2 focus:ring-primary focus:ring-offset-1 transition-all " +
    "disabled:opacity-50 disabled:cursor-not-allowed";

  const isMedia = picked?.kind === "media";

  return (
    <div className="flex flex-col gap-3 p-3 bg-background/60 backdrop-blur rounded-xl border-2 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-bold text-foreground/70 tracking-wide uppercase">
          <Link2 className="h-3.5 w-3.5" />
          Insert link
        </span>

        {/* Pick a page or a media file from Sitecore */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => setPickerMode("page")}
            disabled={disabled}
            className="bg-background shadow-sm"
            title="Pick a page from the Sitecore content tree"
          >
            <FolderTree />
            Insert internal link
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => setPickerMode("media")}
            disabled={disabled}
            className="bg-background shadow-sm"
            title="Pick a PDF or other file from the Sitecore media library"
          >
            <FileDown />
            Insert media link
          </Button>
        </div>
      </div>

      {/* URL */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-foreground/60">URL</span>

        {picked && (
          <div className="flex items-center gap-2 rounded-lg border-2 border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs">
            {isMedia ? (
              <FileDown className="h-3.5 w-3.5 shrink-0 text-primary" />
            ) : (
              <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
            )}
            <span className="shrink-0 font-semibold">
              {isMedia ? "Media file:" : "Sitecore page:"}
            </span>
            <span className="truncate font-medium">
              {picked.displayName}
              {picked.extension ? ` · ${picked.extension}` : ""}
            </span>
            <span
              className="hidden truncate text-foreground/50 sm:inline"
              title={picked.path}
            >
              {picked.path}
            </span>
            <button
              type="button"
              onClick={clearPicked}
              disabled={disabled}
              className="ml-auto shrink-0 rounded-full p-0.5 text-foreground/50 transition-colors hover:bg-primary/10 hover:text-foreground disabled:opacity-50"
              aria-label="Remove the selected item"
              title="Remove the selected item"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <input
          type="text"
          inputMode="url"
          placeholder="https://example.com or /page-path"
          value={url}
          onChange={(e) => handleUrlChange(e.target.value)}
          className={inputClass}
          disabled={disabled}
          aria-label="URL"
        />

        {picked && (
          <span className="text-[11px] text-foreground/50">
            Linked by Sitecore item id, so it keeps working if the item is
            renamed or moved.
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Label */}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-foreground/60">
            Link text
          </span>
          <input
            type="text"
            placeholder="Defaults to the URL"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={inputClass}
            disabled={disabled}
          />
        </label>

        {/* Title / tooltip */}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-foreground/60">
            Title / tooltip (optional)
          </span>
          <input
            type="text"
            placeholder="Shown on hover"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
            disabled={disabled}
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-3">
        {/* Open in new tab */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={openInNewTab}
            onChange={(e) => setOpenInNewTab(e.target.checked)}
            className="h-4 w-4 rounded border-2 accent-primary"
            disabled={disabled}
          />
          <span className="flex items-center gap-1.5 text-sm">
            <ExternalLink className="h-3.5 w-3.5" />
            Open in new tab
          </span>
        </label>

        <Button
          size="sm"
          onClick={handleInsert}
          disabled={disabled || !canInsert}
          className="shadow-sm"
          title={canInsert ? "Insert link into cell" : "Enter a URL first"}
        >
          <Link2 className="h-4 w-4 mr-2" />
          Insert link
        </Button>
      </div>

      <InternalLinkPicker
        open={pickerMode !== null}
        mode={pickerMode ?? "page"}
        onClose={() => setPickerMode(null)}
        onSelect={handlePicked}
      />
    </div>
  );
}

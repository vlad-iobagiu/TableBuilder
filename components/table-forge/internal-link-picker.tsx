"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  useAppContext,
  useMarketplaceClient,
} from "@/components/providers/marketplace";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  FileDown,
  FileText,
  Folder,
  FolderOpen,
  FolderTree,
  Link2,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import {
  type PagePickerContext,
  type PickerKind,
  type PageSource,
  type PageUrlSource,
  type SelectedInternalPage,
  type SitecorePageNode,
  fetchMediaChildren,
  fetchMediaTree,
  fetchPageChildren,
  fetchSiteTree,
  isMediaFile,
  loadPagePickerContext,
  resolveMediaUrl,
  resolvePageUrl,
  sameItemId,
} from "@/lib/sitecore-pages";

interface InternalLinkPickerProps {
  open: boolean;
  /** Which Sitecore tree to browse. Defaults to the site's pages. */
  mode?: PickerKind;
  onClose: () => void;
  /** Called with the chosen item once the author confirms */
  onSelect: (page: SelectedInternalPage) => void;
}

type LoadStatus = "idle" | "loading" | "ready" | "error";

interface ResolvedUrl {
  pageId: string;
  url: string;
  source: PageUrlSource;
  extension?: string;
}

/** Wording and icons that differ between the two trees. */
const MODES = {
  page: {
    title: "Insert internal link",
    treeLabel: "Site pages",
    confirmLabel: "Use this page",
    confirmHint: "Use this page for the link",
    emptyHint: "No pages were found for this site.",
    selectHint:
      "Select a page in the tree (double-click to insert it right away). Folders and the site root cannot be linked.",
    loadingHint: "Loading the site tree…",
    errorTitle: "Couldn't load the site tree",
    unresolved: "This item has no page URL.",
    icon: FolderTree,
  },
  media: {
    title: "Insert media link",
    treeLabel: "Media library",
    confirmLabel: "Use this file",
    confirmHint: "Use this file for the link",
    emptyHint: "No items were found in the media library.",
    selectHint:
      "Select a file in the media library (double-click to insert it right away). Folders cannot be linked.",
    loadingHint: "Loading the media library…",
    errorTitle: "Couldn't load the media library",
    unresolved:
      "No media URL could be resolved. This item is probably a folder rather than a file.",
    icon: FileDown,
  },
} as const;

/**
 * InternalLinkPicker - Modal Sitecore tree for choosing a page or a media file.
 *
 * The tree is loaded lazily, level by level. Which backend answers depends on
 * whether the Marketplace app has API access; see lib/sitecore-pages.ts. Once
 * an item is picked its URL is resolved so the link editor can insert a plain
 * anchor tag.
 */
export function InternalLinkPicker({
  open,
  mode = "page",
  onClose,
  onSelect,
}: InternalLinkPickerProps) {
  const client = useMarketplaceClient();
  const appContext = useAppContext();

  const labels = MODES[mode];
  const isMedia = mode === "media";

  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<PagePickerContext | null>(null);
  const [source, setSource] = useState<PageSource>("marketplace");
  const [rootNodes, setRootNodes] = useState<SitecorePageNode[]>([]);
  const [childrenById, setChildrenById] = useState<
    Record<string, SitecorePageNode[]>
  >({});
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [loadingIds, setLoadingIds] = useState<Record<string, boolean>>({});
  const [branchErrors, setBranchErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<SitecorePageNode | null>(null);
  const [resolved, setResolved] = useState<ResolvedUrl | null>(null);
  const [resolveFailed, setResolveFailed] = useState(false);
  const [resolving, setResolving] = useState(false);

  // Bumped whenever the dialog (re)loads or closes so stale async results are ignored
  const sessionRef = useRef(0);
  const selectedIdRef = useRef<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  /**
   * Load the context and the top of the tree
   */
  const loadTree = useCallback(async () => {
    const session = ++sessionRef.current;
    setStatus("loading");
    setError(null);
    setRootNodes([]);
    setChildrenById({});
    setExpandedIds({});
    setLoadingIds({});
    setBranchErrors({});
    setSelected(null);
    selectedIdRef.current = null;
    setResolved(null);
    setResolveFailed(false);
    setResolving(false);

    try {
      const context = await loadPagePickerContext(client, appContext);
      const tree = isMedia
        ? await fetchMediaTree(client, context)
        : await fetchSiteTree(client, context);
      if (session !== sessionRef.current) return;

      setCtx(context);
      setSource(tree.source);
      setRootNodes(tree.roots);
      setChildrenById(tree.childrenById);
      // Open the first root so its children are visible right away
      const main = tree.roots[0];
      setExpandedIds(main ? { [main.id]: true } : {});
      setStatus("ready");
    } catch (err) {
      if (session !== sessionRef.current) return;
      console.error("[internal-link] Failed to load the tree:", err);
      setError(err instanceof Error ? err.message : "Failed to load the tree.");
      setStatus("error");
    }
  }, [client, appContext, isMedia]);

  // Load when opened, cancel in-flight work when closed
  useEffect(() => {
    if (open) {
      void loadTree();
    } else {
      sessionRef.current++;
    }
  }, [open, loadTree]);

  // Escape closes; focus moves into the dialog
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const loadChildren = async (node: SitecorePageNode) => {
    if (!ctx) return;
    const key = node.id;
    const session = sessionRef.current;
    setLoadingIds((prev) => ({ ...prev, [key]: true }));
    setBranchErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

    try {
      const children = isMedia
        ? await fetchMediaChildren(client, ctx, node, source)
        : await fetchPageChildren(client, ctx, node, source);
      if (session !== sessionRef.current) return;
      setChildrenById((prev) => ({ ...prev, [key]: children }));
    } catch (err) {
      if (session !== sessionRef.current) return;
      console.error("[internal-link] Failed to load children:", err);
      setBranchErrors((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : "Failed to load children.",
      }));
    } finally {
      if (session === sessionRef.current) {
        setLoadingIds((prev) => ({ ...prev, [key]: false }));
      }
    }
  };

  /**
   * Expand/collapse a node, loading its children on first expansion
   */
  const toggleExpand = async (node: SitecorePageNode) => {
    const key = node.id;
    if (expandedIds[key]) {
      setExpandedIds((prev) => ({ ...prev, [key]: false }));
      return;
    }
    setExpandedIds((prev) => ({ ...prev, [key]: true }));
    if (childrenById[key] || loadingIds[key]) return;

    await loadChildren(node);
  };

  const isSelectable = (node: SitecorePageNode): boolean =>
    isMedia ? isMediaFile(node) : node.hasPresentation;

  /**
   * Select an item and resolve its URL. Returns the resolved URL, or null when
   * it cannot be linked or the dialog moved on meanwhile.
   */
  const selectNode = async (
    node: SitecorePageNode
  ): Promise<ResolvedUrl | null> => {
    if (!isSelectable(node) || !ctx) return null;

    setSelected(node);
    selectedIdRef.current = node.id;
    if (resolved && resolved.pageId === node.id) return resolved;

    const session = sessionRef.current;
    setResolved(null);
    setResolveFailed(false);
    setResolving(true);
    try {
      const result: {
        url: string;
        source: PageUrlSource;
        extension?: string;
      } | null = isMedia
        ? await resolveMediaUrl(client, ctx, node, source)
        : await resolvePageUrl(client, ctx, node, source);

      // Ignore if the dialog reloaded or the author already clicked elsewhere
      if (session !== sessionRef.current || selectedIdRef.current !== node.id) {
        return null;
      }
      if (!result) {
        setResolveFailed(true);
        return null;
      }

      const next: ResolvedUrl = {
        pageId: node.id,
        url: result.url,
        source: result.source,
        extension: result.extension,
      };
      setResolved(next);
      return next;
    } finally {
      if (session === sessionRef.current && selectedIdRef.current === node.id) {
        setResolving(false);
      }
    }
  };

  const emit = (node: SitecorePageNode, url: ResolvedUrl) => {
    onSelect({
      id: node.id,
      name: node.name,
      displayName: node.displayName,
      path: node.path,
      url: url.url,
      urlSource: url.source,
      kind: mode,
      extension: url.extension,
    });
  };

  const handleConfirm = () => {
    if (!selected || !resolved || resolved.pageId !== selected.id) return;
    emit(selected, resolved);
  };

  const handleDoubleClick = async (node: SitecorePageNode) => {
    const url = await selectNode(node);
    if (url) emit(node, url);
  };

  if (!open) return null;

  const canConfirm =
    !!selected && !!resolved && resolved.pageId === selected.id && !resolving;
  const TitleIcon = labels.icon;

  const renderNodes = (
    nodes: SitecorePageNode[],
    depth: number
  ): React.ReactNode =>
    nodes.map((node) => {
      const expanded = !!expandedIds[node.id];
      const loading = !!loadingIds[node.id];
      const children = childrenById[node.id];
      const branchError = branchErrors[node.id];
      const expandable = node.hasChildren !== false;
      const selectable = isSelectable(node);
      const isSelected = selected?.id === node.id;
      const isCurrent = !isMedia && sameItemId(node.id, ctx?.currentPageId);
      const NodeIcon = selectable ? FileText : expanded ? FolderOpen : Folder;
      const indent = `${depth * 1.25 + 0.25}rem`;
      const childIndent = `${(depth + 1) * 1.25 + 0.25}rem`;

      return (
        <li
          key={node.id}
          role="treeitem"
          aria-expanded={expandable ? expanded : undefined}
          aria-selected={selectable ? isSelected : undefined}
        >
          <div
            className={cn(
              "group flex items-center gap-1 rounded-lg py-1 pr-2 transition-colors",
              selectable ? "cursor-pointer" : "cursor-default",
              isSelected
                ? "bg-primary/10 ring-1 ring-primary/40"
                : selectable
                  ? "hover:bg-primary/5"
                  : ""
            )}
            style={{ paddingLeft: indent }}
            onClick={() => {
              if (selectable) void selectNode(node);
            }}
            onDoubleClick={() => {
              if (selectable) void handleDoubleClick(node);
            }}
            title={node.path || undefined}
          >
            {expandable ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleExpand(node);
                }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-foreground/60 hover:bg-primary/10 hover:text-foreground"
                aria-label={expanded ? "Collapse" : "Expand"}
              >
                {loading ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                ) : expanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
            ) : (
              <span className="h-5 w-5 shrink-0" aria-hidden="true" />
            )}

            <NodeIcon
              className={cn(
                "h-4 w-4 shrink-0",
                selectable ? "text-primary" : "text-foreground/40"
              )}
            />
            <span
              className={cn(
                "truncate",
                !selectable && "text-foreground/60",
                isSelected && "font-semibold"
              )}
            >
              {node.displayName}
            </span>
            {isCurrent && (
              <span className="ml-1 shrink-0 rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                current
              </span>
            )}
            {!selectable && (
              <span className="ml-1 shrink-0 text-[10px] uppercase tracking-wide text-foreground/40">
                folder
              </span>
            )}
          </div>

          {expanded && (
            <ul role="group">
              {branchError && (
                <li
                  className="py-1 text-xs text-danger-fg"
                  style={{ paddingLeft: childIndent }}
                >
                  {branchError}{" "}
                  <button
                    type="button"
                    onClick={() => void loadChildren(node)}
                    className="font-semibold underline underline-offset-2"
                  >
                    Retry
                  </button>
                </li>
              )}
              {!branchError && !loading && children && children.length === 0 && (
                <li
                  className="py-1 text-xs italic text-muted-foreground"
                  style={{ paddingLeft: childIndent }}
                >
                  Nothing inside
                </li>
              )}
              {children && children.length > 0 && renderNodes(children, depth + 1)}
            </ul>
          )}
        </li>
      );
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-150"
      onMouseDown={(e) => {
        // Click on the backdrop (not inside the dialog) closes
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="internal-link-picker-title"
        tabIndex={-1}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border-2 bg-background shadow-2xl outline-none animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <TitleIcon className="h-4 w-4 shrink-0 text-primary" />
            <h2
              id="internal-link-picker-title"
              className="text-xs font-bold uppercase tracking-wide text-foreground/80"
            >
              {labels.title}
            </h2>
            {ctx?.siteName && !isMedia && (
              <span className="truncate rounded-full border px-2 py-0.5 text-xs text-foreground/60">
                {ctx.siteName}
                {ctx.language ? ` · ${ctx.language}` : ""}
              </span>
            )}
            {status === "ready" && source === "server" && (
              <span
                className="shrink-0 rounded-full bg-warning-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-fg"
                title="The Marketplace app has no API access, so the tree is being read with this deployment's own Sitecore credentials."
              >
                server credentials
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => void loadTree()}
              disabled={status === "loading"}
              title="Reload"
              aria-label="Reload"
            >
              <RefreshCw className={status === "loading" ? "animate-spin" : ""} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={onClose}
              title="Close"
              aria-label="Close"
            >
              <X />
            </Button>
          </div>
        </div>

        {/* Tree */}
        <div className="min-h-[12rem] flex-1 overflow-auto p-2">
          {status === "loading" && (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              {labels.loadingHint}
            </div>
          )}

          {status === "error" && (
            <Alert variant="danger" className="m-2 border-2">
              <AlertTitle>{labels.errorTitle}</AlertTitle>
              <AlertDescription>
                <p>{error}</p>
                <button
                  type="button"
                  onClick={() => void loadTree()}
                  className="text-sm font-semibold underline underline-offset-2"
                >
                  Try again
                </button>
              </AlertDescription>
            </Alert>
          )}

          {status === "ready" && rootNodes.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              {labels.emptyHint}
            </p>
          )}

          {status === "ready" && rootNodes.length > 0 && (
            <ul role="tree" aria-label={labels.treeLabel} className="text-sm">
              {renderNodes(rootNodes, 0)}
            </ul>
          )}
        </div>

        {/* Selection summary + actions */}
        <div className="border-t bg-muted/40 px-4 py-3">
          <div className="min-h-[2.75rem] text-xs">
            {selected ? (
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-semibold text-foreground">
                  {selected.displayName}
                  {resolved?.extension ? ` · ${resolved.extension}` : ""}
                </span>
                <span
                  className="truncate text-foreground/50"
                  title={selected.path}
                >
                  {selected.path}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-foreground/70">
                  <Link2 className="h-3 w-3 shrink-0" />
                  {resolving ? (
                    <span className="italic">Resolving URL…</span>
                  ) : resolveFailed ? (
                    <span className="text-danger-fg">{labels.unresolved}</span>
                  ) : (
                    <span className="truncate font-mono">
                      {resolved?.url ?? "—"}
                    </span>
                  )}
                  {!resolving && !resolveFailed && resolved?.source === "derived" && (
                    <span className="shrink-0 rounded-full bg-warning-bg px-1.5 py-0.5 text-[10px] font-semibold text-warning-fg">
                      built from the item, please verify
                    </span>
                  )}
                </span>
              </div>
            ) : (
              <span className="text-muted-foreground">{labels.selectHint}</span>
            )}
          </div>

          <div className="mt-2 flex items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="shadow-sm"
              title={canConfirm ? labels.confirmHint : "Select an item first"}
            >
              <Link2 className="h-4 w-4 mr-2" />
              {labels.confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

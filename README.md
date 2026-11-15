# TableBuilder (Grid Composer)

A visual table editor for **Sitecore XM Cloud**, built as a Marketplace custom field. Authors build tables in a friendly UI, and the data is saved as structured JSON that any front-end component can render.

## Features

- **Visual table editing**: add, remove and reorder rows and columns, with an optional header row.
- **Cell and row formatting**: alignment, font weight, text and background colors, and row-level formats.
- **Merged cells**: column and row spans.
- **Links in cells**: external URLs, plus internal page and media library links picked from the Sitecore tree.
  - Internal links are stored by Sitecore **item id** (`/~/link.aspx?_id=<ID>&_z=z` for pages, `/~/media/<ID>.ashx` for media), so they survive renames and moves.
- **Legacy table import**: migrate existing tables from legacy content.
- **Safe HTML**: cell HTML is sanitized with DOMPurify.
- **Table settings**: caption, borders and striped rows.

## Tech stack

- [Next.js](https://nextjs.org/) (App Router) and React 19
- TypeScript
- Tailwind CSS 4, Radix UI and lucide-react
- [Sitecore Marketplace SDK](https://doc.sitecore.com/xmc/en/developers/marketplace/) (`@sitecore-marketplace-sdk/client` and `xmc`)
- DOMPurify (`isomorphic-dompurify`)

## Getting started

### Prerequisites

- Node.js 20 or later
- A Sitecore XM Cloud organization with permission to register a Marketplace custom app

### Install and run

```bash
npm install
npm run dev
```

The dev server starts on [http://localhost:3000](http://localhost:3000). The app runs inside the Sitecore Marketplace host iframe, so register it in the Sitecore Cloud Portal as a **custom field** extension pointing at your deployment URL (or `http://localhost:3000` for development).

### Scripts

| Script          | Description                      |
| --------------- | -------------------------------- |
| `npm run dev`   | Start the dev server (Turbopack) |
| `npm run build` | Create a production build        |
| `npm start`     | Serve the production build       |
| `npm run lint`  | Run ESLint                       |

## Configuration

Create a `.env.local` file. All values are optional fallbacks, used when the Marketplace host grants the app no API access.

| Variable                          | Scope  | Purpose                                                                        |
| --------------------------------- | ------ | ------------------------------------------------------------------------------ |
| `SITECORE_PREVIEW_CONTEXT_ID`     | Build  | Fallback XM Cloud preview context id for the link picker and legacy import     |
| `SITECORE_CM_HOST`                | Server | XM Cloud environment host read by the link picker fallback                     |
| `SITECORE_CLIENT_ID`              | Server | Automation client id from XM Cloud Deploy                                      |
| `SITECORE_CLIENT_SECRET`          | Server | Automation client secret. **Never** expose it as `NEXT_PUBLIC_*`.              |
| `SITECORE_AUTH_AUTHORITY`         | Server | Auth authority (default `https://auth.sitecorecloud.io`)                       |
| `SITECORE_AUTH_AUDIENCE`          | Server | Auth audience (default `https://api.sitecorecloud.io`)                         |
| `SITECORE_EDGE_URL`               | Server | Experience Edge URL (default `https://edge-platform.sitecorecloud.io`)         |
| `SITECORE_MEDIA_HOST`             | Server | Host prefixed to media URLs                                                    |

Prefer granting the app API access to the XM Cloud environment in the Sitecore Cloud Portal. That works per installation, while the environment variables tie the deployment to a single environment.

> **Security note:** the `/api/sitecore/*` routes use the automation client and have no caller authentication, because the app runs in an iframe with no identity of its own. They are read-only and limited to `/sitecore/content` and media. Deploy accordingly, and never commit `.env.local`.

## Project structure

```
app/
  api/sitecore/        Server routes: tree, page-url, media-url
components/
  table-forge/         Table editor (builder, cells, toolbars, link picker)
  providers/           Marketplace SDK provider
  ui/                  Shared UI primitives
lib/
  types/table.ts       Table data model, helpers and validation
  item-id.ts           Sitecore item id and link helpers
  sitecore-pages.ts    Page and media tree loading and URL resolution
  legacy-*.ts          Legacy table fetch and conversion
  sanitize.ts          HTML sanitization
  server/              Sitecore Authoring and Edge clients
scripts/               Helper scripts (credential check)
```

## Data format

The field value is a JSON-serialized `TableData` object (see [lib/types/table.ts](lib/types/table.ts)):

```json
{
  "version": "1.0",
  "columns": [{ "id": "c1" }, { "id": "c2" }],
  "rows": [
    {
      "id": "r1",
      "isHeader": true,
      "cells": [
        { "id": "a", "content": "Name" },
        { "id": "b", "content": "Link" }
      ]
    }
  ],
  "settings": { "hasHeaderRow": true, "hasBorders": true, "isStriped": false }
}
```

Cell content is sanitized inline HTML. Cells can carry format, link and span (`colSpan` / `rowSpan`) properties. The example above is abbreviated, so refer to the type definitions for the full shape.

## Deployment

The app is a standard Next.js project and deploys to any Node host. Vercel is the simplest option.

1. Set the environment variables above in your hosting provider. `NEXT_PUBLIC_*` values are inlined at build time.
2. Deploy.
3. Register the deployed URL as the custom field app in the Sitecore Cloud Portal and install it on your XM Cloud environment.

## License

Add a license of your choice before publishing.

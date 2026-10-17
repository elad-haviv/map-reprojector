# Map Reprojector

A browser app for exploring map projections with raster images and SVG maps, built with React, TypeScript, Vite, and D3.

## Features

- Import PNG, JPG, or SVG maps.
- Switch between globe, Mercator, equirectangular, Robinson, Mollweide, Winkel Tripel, Fahey, and Natural Earth projections.
- Rotate and zoom the map, manage SVG layers, and export the view.
- Press F for region focus or Esc to cancel it.

## Run locally

Use a current Node.js LTS release compatible with Vite 8 (Node 22.12+ or 24 recommended).

```sh
npm ci
npm run dev
```

Open the local address printed by Vite.

## Other commands

```sh
npm run build
npm run preview
npm run lint
```

The production build is written to `dist/`. Dependencies, generated builds, environment files, and local logs are excluded from version control.

## Current status

The initial source snapshot has existing TypeScript errors in App, LayerPanel, MapCanvas, pixelMapper, and SVGParser, so the production build needs those errors resolved. Development uses Vite's development server.

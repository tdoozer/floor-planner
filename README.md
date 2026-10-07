# Floor Planner

A browser-based planner for a house's ground floor, built to check every pipe,
cable and floor layer **before the concrete screed is poured** — after that,
nothing inside it can be changed.

The interface is in Russian: I built this for myself, not to ship.

## What it does

- **Plan with layers** — walls and rooms are *derived* from four layout numbers,
  not stored as shapes. Two layout variants share one measured perimeter.
- **Catalogue with connection points** — fixtures know where their water, drain,
  gas and power connect.
- **Underfloor heating** — heat-loss calculation, loop layout (length limits,
  furniture exclusion), pump and hydraulics check, boiler-room schematic.
- **Floor build-up** — layer thicknesses against the available height and threshold.
- **Rules validator** — drain slope, stair geometry, clearances, loop length.
- **Electrics** — lines, panel schematic (generated as SVG from the model),
  emergency power (UPS) runtime, low-voltage routing.
- **Fabrication drawings** and **cost estimate**.
- **3D "screed X-ray"** — Three.js view of slab, pipes and cables at their real depths.
- **AI render** — the prompt is *assembled from the placement* (what is in frame
  from a chosen viewpoint), then sent to an image model.

Calculation modules in `src/calc/` are pure functions with no UI or Three.js
dependency, which is why they can be covered by tests (551 passing).

## Stack

React 19, Vite, Three.js, react-rnd, html2canvas + jsPDF. State lives in
`localStorage`; there is no backend.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test
npm run build
```

## Deploy (Cloudflare Pages)

The AI render calls `/prompt/...`. In dev this is a Vite proxy, in Docker an
nginx proxy, and on Cloudflare Pages the Function in `functions/prompt/`.

```bash
npm run build
npx wrangler pages deploy dist --project-name=floor-planner
```

## Notes

The sample project is a real house; location details were removed for
publication. Norms and thresholds in the calculations are engineering
assumptions, not certified design values. See `CHANGELOG.md` for the history
and the reasoning behind each change.

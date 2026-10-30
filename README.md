# AEROSPACE — Interactive 3D Space Explorer

A cinematic, procedurally-generated 3D solar system built with Three.js r160. Zero external assets — all textures, stars, galaxies and effects are generated at runtime.

## Run

```bash
npx serve .
```

Open `http://localhost:3000` in a modern browser.

## File Architecture

| File | Purpose |
|---|---|
| `index.html` | Entry point, HTML structure, import map |
| `style.css` | Full styling, CSS variables for theming |
| `js/data.js` | All body data (add a planet = add one object) |
| `js/state.js` | Reactive central store with subscribe() |
| `js/scene.js` | Three.js scene, procedural textures, effects |
| `js/ui.js` | HUD panels, search, filters, controls, keyboard |
| `js/compare.js` | Compare drawer with Chart.js bar/radar chart |
| `js/main.js` | Init, loading screen, animation loop |

## 60-Second Judge Demo

1. **Load** → Watch cinematic intro fly-in with "AEROSPACE" title
2. **Click Sun** → See animated plasma shader with bloom and corona
3. **Click Earth** → Camera follows it orbiting; note clouds, atmosphere glow, Moon
4. **Click Saturn** → Admire ring system and axial tilt
5. **Press T** → Auto-tour flies through all bodies with captions
6. **Press C** → Compare drawer: switch to radar chart, see bar highlights
7. **Drag speed slider** → Watch planets race; note asteroid belt rotation
8. **Toggle Orbits/Trails/Labels** → Real-time visual controls
9. **Navigate to Black Hole** → Glowing accretion disk with doppler beaming
10. **Press R** → Reset view; mention keyboard shortcuts and responsive design

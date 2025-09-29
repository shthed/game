# Architecture and Design

## Repository Overview

The project hosts two interactive demos:

- `index.html` is the primary Babylon.js experience that bootstraps the UI, scene, and procedural world generator exposed through `world.js`.
- `main.js` is a standalone Three.js playground that demonstrates a pointer-lock FPS controller against a wireframe test arena.
- `world.js` encapsulates deterministic terrain synthesis, hydrology, and landmark placement that can be reused by any Babylon scene.

## Entry Points

### `index.html`
`index.html` loads Babylon.js and the world generator, restores persisted settings, and spins up the main scene. The DOMContentLoaded handler creates the engine, camera, sky, and UI wiring before delegating all terrain construction to the shared generator.【F:index.html†L120-L320】

World rebuilds are coordinated through `rebuildWorld`, which invokes `WorldGen.createWorldGenerator(...).build(...)` and then regenerates trees, updates the seed UI, and optionally respawns the camera.【F:index.html†L185-L205】【F:index.html†L233-L264】 The per-frame observable advances the generator’s water animation, performs character movement from keyboard or touch input, and clamps the camera to the terrain height.【F:index.html†L288-L305】

### `main.js`
`main.js` exports a minimal Three.js sandbox with pointer-lock controls, a procedural cube scatter, and a static ground plane. It is isolated from the Babylon stack and can be used for quick control experiments.【F:main.js†L1-L109】

## Procedural World Engine (`world.js`)

`world.js` exposes a `WorldGen` namespace with deterministic utilities:

- **Noise stack:** Multiple Perlin generators combine to form ridged mountains, valleys, erosion masks, and a water table, producing both height and water samples via `heightFuncFactory`.【F:world.js†L77-L130】
- **Landmarks:** Seeded cliff, mesa, and ruin placements are generated up front and blended into the terrain or spawned as meshes during world builds.【F:world.js†L132-L246】
- **World generator:** `createWorldGenerator` manages mesh lifecycles, rebuilds ground and water geometry, applies erosion-driven river carving, hooks optional material factories, and exposes helpers such as `groundHeightAt`, `pickSpawn`, and `update` for scene integration.【F:world.js†L323-L583】

The generator’s `build` method returns references to generated meshes and data fields so callers can construct textures, scatter props, or drive gameplay logic.【F:world.js†L382-L545】

## Scene Integration Flow

`index.html` creates a generator instance (`WorldGen.createWorldGenerator(scene, worldConfig)`) and caches the returned helpers. When `rebuildWorld` runs, it requests a ground material via `groundMaterialFactory`, rebuilds the terrain, and then scatters instanced trees based on the new height samples.【F:index.html†L185-L205】【F:index.html†L233-L252】 Camera respawns rely on `worldGen.pickSpawn()`, which samples the regenerated height field.【F:index.html†L254-L264】【F:world.js†L370-L380】

Trees reuse hidden base meshes and place instances with per-tree transforms, allowing quick disposal and re-spawn while maintaining GPU efficiency.【F:index.html†L208-L252】

## Persistence and Options UI

Settings (invert axes, sensitivity, movement speed, graphics quality, sky toggle, tree count) and the active seed are serialized to localStorage via `safeLoad` / `safeSave`. The options panel synchronizes form controls with the settings object and updates the engine scaling or world state in response to user input.【F:index.html†L93-L119】【F:index.html†L309-L324】 Rebuilding the world persists the new seed and rebinds control values so the UI reflects the current terrain configuration.【F:index.html†L185-L205】【F:index.html†L309-L324】

## Update Loop and Input Handling

Mouse, keyboard, and touch inputs are normalized into directional vectors that update camera rotation and translation each frame. Pointer movement uses configurable sensitivity and inversion, while touch controls split the screen between a virtual stick and look pad.【F:index.html†L271-L305】 The Babylon render loop drives both scene rendering and the world generator’s animated water material through `worldGen.update(dt)`.【F:index.html†L288-L306】

## Extensibility Hooks

Consumers can supply custom material factories when calling `worldGen.build`, allowing bespoke ground textures, animated water shaders, or ruin materials without forking the terrain logic.【F:world.js†L470-L543】 Combined with the exposed sampling helpers (`getSampler`, `groundHeightAt`, etc.), external systems can place gameplay props, spawn entities, or query hydrology data against the generated world.【F:world.js†L570-L583】


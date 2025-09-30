# game

A sandbox-friendly Babylon.js exploration demo with procedural terrain and instanced foliage.

## Usage

1. Start a static web server in this directory, e.g. with [http-server](https://www.npmjs.com/package/http-server):

   ```bash
   npx http-server .
   ```

2. Open `http://localhost:8080` in your browser.
3. Drag the left mouse button to look around and use **WASD / Arrow keys** to move. Hold the right mouse button to walk forward, or use the on-screen touch controls on mobile.
4. Configure graphics, controls, and world options through the in-game **Options** button. Settings and world seeds persist in local storage.

Babylon.js loads from a CDN; no build step or install is required.

## Terrain generation architecture

The world heightmap is generated procedurally inside `index.html`:

* **Noise sampling.** `createHeightSampler` constructs a multi-octave Perlin sampler that outputs normalized heights before scaling them to meters. The sampler exposes helpers to fill dense height maps so different systems can share consistent data.
* **Chunk meshing.** `createTerrainTileBuilder` lazily generates a cached height field per streamed chunk. Each Babylon ground mesh is rebuilt from the cached grid and reuses the same data for later sampling queries.
* **World streaming.** `WorldStreamer` keeps a pool of chunk meshes around the camera, requesting tiles from the terrain builder as the player moves.
* **Surface shading.** `makeGroundTexture` re-samples the height sampler to synthesize a diffuse texture that matches the physical terrain, using slope information for simple lighting cues.
* **Gameplay queries.** `terrainHeightAt` retrieves the terrain height from the cache (falling back to the sampler) so movement, tree placement, and other systems stay aligned with the rendered ground. The camera applies a fixed eye-height offset above this sampled ground to keep navigation smooth.

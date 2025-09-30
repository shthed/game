export class WorldStreamer {
  constructor(scene, camera, options) {
    this.scene = scene;
    this.camera = camera;
    this.size = options.size;
    this.radius = options.radius ?? 2;
    this.buildTile = options.buildTile;
    this.pool = [];
    this.active = new Map();
    this.center = null;
    this.tileId = 0;

    this.scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
    this.scene.fogColor = new BABYLON.Color3(
      this.scene.clearColor.r,
      this.scene.clearColor.g,
      this.scene.clearColor.b
    );
    this._applyViewSettings();
  }

  _applyViewSettings() {
    const span = this.size * (this.radius * 2 + 1);
    this.camera.maxZ = span * 1.4;
    this.scene.fogStart = span * 0.6;
    this.scene.fogEnd = span * 1.1;
  }

  _chunkKey(ix, iz) {
    return `${ix},${iz}`;
  }

  _chunkCoords(x, z) {
    const size = this.size;
    const ix = Math.floor((x + size * 0.5) / size);
    const iz = Math.floor((z + size * 0.5) / size);
    return { ix, iz };
  }

  _acquireTile(ix, iz) {
    const centerX = ix * this.size;
    const centerZ = iz * this.size;
    let mesh = this.pool.pop() ?? null;
    mesh = this.buildTile(mesh, centerX, centerZ, ix, iz);
    mesh.name = `chunk_${ix}_${iz}_${this.tileId++}`;
    mesh.setEnabled(true);
    return { mesh, ix, iz };
  }

  _releaseTile(entry) {
    entry.mesh.setEnabled(false);
    this.pool.push(entry.mesh);
  }

  update(force = false) {
    this._applyViewSettings();
    const { ix, iz } = this._chunkCoords(this.camera.position.x, this.camera.position.z);
    const changed = !this.center || this.center.ix !== ix || this.center.iz !== iz;
    if (!changed && !force) return;
    this.center = { ix, iz };

    const needed = [];
    const neededKeys = new Set();
    for (let dz = -this.radius; dz <= this.radius; dz++) {
      for (let dx = -this.radius; dx <= this.radius; dx++) {
        const cx = ix + dx;
        const cz = iz + dz;
        const key = this._chunkKey(cx, cz);
        needed.push({ key, ix: cx, iz: cz });
        neededKeys.add(key);
      }
    }

    for (const [key, entry] of Array.from(this.active.entries())) {
      if (!neededKeys.has(key)) {
        this.active.delete(key);
        this._releaseTile(entry);
      }
    }

    for (const chunk of needed) {
      if (!this.active.has(chunk.key)) {
        const entry = this._acquireTile(chunk.ix, chunk.iz);
        this.active.set(chunk.key, entry);
      }
    }
  }

  rebuildActive() {
    for (const entry of this.active.values()) {
      const centerX = entry.ix * this.size;
      const centerZ = entry.iz * this.size;
      entry.mesh = this.buildTile(entry.mesh, centerX, centerZ, entry.ix, entry.iz);
    }
  }

  activeCount() {
    return this.active.size;
  }
}

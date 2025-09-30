class Perlin {
  constructor(seed = 1) {
    this.p = new Uint8Array(512);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    let s = seed >>> 0;
    for (let i = 255; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const j = s % (i + 1);
      const t = perm[i];
      perm[i] = perm[j];
      perm[j] = t;
    }
    for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
  }

  fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  lerp(t, a, b) {
    return a + t * (b - a);
  }

  grad(h, x, y, z) {
    const H = h & 15;
    const u = H < 8 ? x : y;
    const v = H < 4 ? y : H === 12 || H === 14 ? x : z;
    return ((H & 1) === 0 ? u : -u) + ((H & 2) === 0 ? v : -v);
  }

  noise(x, y = 0, z = 0) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = this.fade(x);
    const v = this.fade(y);
    const w = this.fade(z);
    const p = this.p;
    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;

    return this.lerp(
      w,
      this.lerp(
        v,
        this.lerp(u, this.grad(p[AA], x, y, z), this.grad(p[BA], x - 1, y, z)),
        this.lerp(u, this.grad(p[AB], x, y - 1, z), this.grad(p[BB], x - 1, y - 1, z))
      ),
      this.lerp(
        v,
        this.lerp(u, this.grad(p[AA + 1], x, y, z - 1), this.grad(p[BA + 1], x - 1, y, z - 1)),
        this.lerp(u, this.grad(p[AB + 1], x, y - 1, z - 1), this.grad(p[BB + 1], x - 1, y - 1, z - 1))
      )
    );
  }
}

export const createHeightSampler = (config, seed) => {
  const perlin = new Perlin(seed);
  const baseFreq = 0.012;

  const sampleNormalized = (x, z) => {
    const n1 = perlin.noise(x * baseFreq, 0, z * baseFreq);
    const n2 = perlin.noise(x * baseFreq * 2, 0, z * baseFreq * 2) * 0.5;
    const n3 = perlin.noise(x * baseFreq * 4, 0, z * baseFreq * 4) * 0.25;
    const h = (n1 + n2 + n3) * 0.5 + 0.5;
    return BABYLON.Scalar.Lerp(h, 0.5, config.flatten);
  };

  const sampleHeight = (x, z) => sampleNormalized(x, z) * config.height;

  const fillHeightMap = (opts = {}) => {
    const {
      width = config.subdivisions + 1,
      height = config.subdivisions + 1,
      originX = -config.size * 0.5,
      originZ = -config.size * 0.5,
      stepX,
      stepZ,
      normalize = false,
      target,
      map,
    } = opts;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    const dx = typeof stepX === 'number' ? stepX : w > 1 ? config.size / (w - 1) : config.size;
    const dz = typeof stepZ === 'number' ? stepZ : h > 1 ? config.size / (h - 1) : config.size;
    const array = target ?? new Float32Array(w * h);
    let idx = 0;
    for (let zi = 0; zi < h; zi++) {
      const zPos = originZ + zi * dz;
      for (let xi = 0; xi < w; xi++) {
        const xPos = originX + xi * dx;
        const value = normalize ? sampleNormalized(xPos, zPos) : sampleHeight(xPos, zPos);
        if (typeof map === 'function') {
          const mapped = map({ value, x: xPos, z: zPos, index: idx, width: w, height: h });
          array[idx++] = mapped ?? value;
        } else {
          array[idx++] = value;
        }
      }
    }
    return array;
  };

  const sampler = (x, z) => sampleHeight(x, z);
  sampler.sampleHeight = sampleHeight;
  sampler.sampleNormalized = sampleNormalized;
  sampler.fillHeightMap = fillHeightMap;
  sampler.createHeightMap = fillHeightMap;
  return sampler;
};

export const createTerrainTileBuilder = (scene, config, samplerRef, material) => {
  const { size, subdivisions } = config;
  const width = subdivisions + 1;
  const step = size / subdivisions;
  const half = size * 0.5;
  let templatePositions = null;
  const heightFields = new Map();

  const chunkKey = (ix, iz) => `${ix},${iz}`;

  const ensureField = (ix, iz) => {
    const key = chunkKey(ix, iz);
    let field = heightFields.get(key);
    if (field) return field;
    const sampler = samplerRef();
    if (typeof sampler !== 'function') return null;
    const originX = ix * size - half;
    const originZ = iz * size - half;
    let heights;
    if (typeof sampler.fillHeightMap === 'function') {
      heights = sampler.fillHeightMap({
        width,
        height: width,
        originX,
        originZ,
        stepX: step,
        stepZ: step,
      });
    } else {
      heights = new Float32Array(width * width);
      let idx = 0;
      for (let zi = 0; zi < width; zi++) {
        const zPos = originZ + zi * step;
        for (let xi = 0; xi < width; xi++) {
          const xPos = originX + xi * step;
          heights[idx++] = sampler(xPos, zPos);
        }
      }
    }
    field = { originX, originZ, step, width, heights };
    heightFields.set(key, field);
    return field;
  };

  const sampleHeightFromField = (field, x, z) => {
    const maxCoord = field.width - 1 - 1e-6;
    const fx = Math.min(Math.max((x - field.originX) / field.step, 0), maxCoord);
    const fz = Math.min(Math.max((z - field.originZ) / field.step, 0), maxCoord);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    if (ix < 0 || iz < 0 || ix >= field.width - 1 || iz >= field.width - 1) return null;
    const tx = fx - ix;
    const tz = fz - iz;
    const row = iz * field.width;
    const i00 = row + ix;
    const i10 = i00 + 1;
    const i01 = row + field.width + ix;
    const i11 = i01 + 1;
    const h00 = field.heights[i00];
    const h10 = field.heights[i10];
    const h01 = field.heights[i01];
    const h11 = field.heights[i11];
    if (tx + tz <= 1) {
      return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    }
    return h11 + (h10 - h11) * (1 - tz) + (h01 - h11) * (1 - tx);
  };

  const chunkCoords = (x, z) => {
    const ix = Math.floor((x + half) / size);
    const iz = Math.floor((z + half) / size);
    return { ix, iz };
  };

  const buildTile = (mesh, centerX, centerZ, ix, iz) => {
    let groundMesh = mesh;
    if (!groundMesh) {
      groundMesh = BABYLON.MeshBuilder.CreateGround(
        'chunk',
        { width: size, height: size, subdivisions, updatable: true },
        scene
      );
      groundMesh.material = material;
      groundMesh.isPickable = false;
    }
    const positions = groundMesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    if (!templatePositions) templatePositions = positions.slice();
    const field = ensureField(ix, iz);
    if (!field) return groundMesh;
    const { heights } = field;
    for (let i = 0, v = 0; i < positions.length; i += 3, v++) {
      positions[i] = templatePositions[i];
      positions[i + 2] = templatePositions[i + 2];
      positions[i + 1] = heights[v];
    }
    groundMesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
    const normals = groundMesh.getVerticesData(BABYLON.VertexBuffer.NormalKind);
    BABYLON.VertexData.ComputeNormals(positions, groundMesh.getIndices(), normals);
    groundMesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
    groundMesh.position.set(centerX, 0, centerZ);
    groundMesh.refreshBoundingInfo();
    return groundMesh;
  };

  const sampleHeight = (x, z) => {
    const { ix, iz } = chunkCoords(x, z);
    const field = ensureField(ix, iz);
    if (!field) return null;
    return sampleHeightFromField(field, x, z);
  };

  const clearCache = () => {
    heightFields.clear();
    templatePositions = null;
  };

  return { buildTile, sampleHeight, clearCache, ensureField, sampleHeightFromField, chunkCoords };
};

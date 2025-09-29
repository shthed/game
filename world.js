(function(global){
  'use strict';

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
    fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    lerp(t, a, b) { return a + t * (b - a); }
    grad(h, x, y, z) {
      const H = h & 15;
      const u = H < 8 ? x : y;
      const v = H < 4 ? y : (H === 12 || H === 14 ? x : z);
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
      return this.lerp(w,
        this.lerp(v,
          this.lerp(u, this.grad(p[AA], x, y, z), this.grad(p[BA], x - 1, y, z)),
          this.lerp(u, this.grad(p[AB], x, y - 1, z), this.grad(p[BB], x - 1, y - 1, z))
        ),
        this.lerp(v,
          this.lerp(u, this.grad(p[AA + 1], x, y, z - 1), this.grad(p[BA + 1], x - 1, y, z - 1)),
          this.lerp(u, this.grad(p[AB + 1], x, y - 1, z - 1), this.grad(p[BB + 1], x - 1, y - 1, z - 1))
        )
      );
    }
  }

  function mulberry32(a) {
    return function() {
      a |= 0;
      a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function newSeed() {
    try {
      const buf = new Uint32Array(1);
      global.crypto.getRandomValues(buf);
      return buf[0] >>> 0;
    } catch {
      return (Math.random() * 0xFFFFFFFF) >>> 0;
    }
  }

  function heightFuncFactory(world, seed) {
    const ridgeNoise = new Perlin(seed);
    const valleyNoise = new Perlin((seed * 1664525 + 1013904223) >>> 0);
    const erosionNoise = new Perlin((seed * 69069 + 1) >>> 0);
    const detailNoise = new Perlin(seed ^ 0x9e3779b9);
    const waterNoise = new Perlin(seed ^ 0x5f356495);
    const baseFreq = 0.005;

    const fbm = (noise, x, z, freq, lacunarity, gain, octaves, ridged = false) => {
      let amp = 1;
      let sum = 0;
      let total = 0;
      let f = freq;
      for (let o = 0; o < octaves; o++) {
        let n = noise.noise(x * f, 0, z * f);
        n = ridged ? (1 - Math.abs(n)) : (n * 0.5 + 0.5);
        sum += n * amp;
        total += amp;
        amp *= gain;
        f *= lacunarity;
      }
      return total > 0 ? sum / total : 0;
    };

    const sample = (x, z) => {
      const ridge = fbm(ridgeNoise, x, z, baseFreq * 0.65, 2.0, 0.5, 4, true);
      const valley = fbm(valleyNoise, x, z, baseFreq, 2.1, 0.55, 5, false);
      const erosion = fbm(erosionNoise, x, z, baseFreq * 1.6, 2.2, 0.6, 3, true);
      const mask = fbm(valleyNoise, x, z, baseFreq * 0.5, 2.0, 0.7, 3, false);
      const detail = fbm(detailNoise, x, z, baseFreq * 3.2, 2.3, 0.45, 3, false);

      let blend = BABYLON.Scalar.Lerp(valley, ridge, Math.pow(mask, 1.2));
      const erosionWeight = Math.pow(erosion, 0.8);
      blend = BABYLON.Scalar.Lerp(blend, valley, (1 - erosionWeight) * 0.5);
      blend += detail * 0.25 * erosionWeight;
      blend = BABYLON.Scalar.Clamp(blend, 0, 1);
      blend = BABYLON.Scalar.Lerp(blend, 0.5, world.flat);

      const height = blend * world.height;

      let waterMask = valley * 0.75 + (1 - mask) * 0.25;
      waterMask += Math.pow(1 - erosionWeight, 2.5) * 0.35;
      waterMask += (waterNoise.noise(x * baseFreq * 0.8, 0, z * baseFreq * 0.8) * 0.5 + 0.5) * 0.1;
      waterMask = BABYLON.Scalar.Clamp(waterMask - 0.4, 0, 1);
      const water = waterMask * world.height * 0.85;

      return { height, water, ridge, valley, erosion: erosionWeight, mask };
    };

    const sampler = (x, z) => sample(x, z).height;
    sampler.sample = sample;
    sampler.water = (x, z) => sample(x, z).water;
    return sampler;
  }

  function landmarkSeeds(seed, world) {
    const rng = mulberry32(seed ^ 0x1234abcd);
    const within = (r) => (rng() - 0.5) * r;
    const cliffs = Array.from({ length: 3 }, () => ({
      x: within(world.size * 0.6),
      z: within(world.size * 0.6),
      radius: 18 + rng() * 22,
      theta: rng() * Math.PI * 2
    }));
    const mesas = Array.from({ length: 2 }, () => ({
      x: within(world.size * 0.5),
      z: within(world.size * 0.5),
      radius: 16 + rng() * 18,
      height: 3 + rng() * 4
    }));
    const ruins = Array.from({ length: 4 }, () => ({
      x: within(world.size * 0.55),
      z: within(world.size * 0.55),
      yaw: rng() * Math.PI * 2
    }));
    return { cliffs, mesas, ruins };
  }

  function applyLandmarks(heightField, baseHeights, waterHeights, xzCoords, seeds) {
    const count = heightField.length;
    const { cliffs, mesas } = seeds;

    cliffs.forEach((cfg) => {
      const dirX = Math.cos(cfg.theta);
      const dirZ = Math.sin(cfg.theta);
      for (let idx = 0; idx < count; idx++) {
        const x = xzCoords[idx * 2];
        const z = xzCoords[idx * 2 + 1];
        const dx = x - cfg.x;
        const dz = z - cfg.z;
        const dist = Math.hypot(dx, dz);
        if (dist > cfg.radius) continue;
        const side = (dx * dirX + dz * dirZ) / cfg.radius;
        const influence = Math.pow(Math.max(0, 1 - dist / cfg.radius), 1.8);
        const delta = (side > 0 ? 1 : -1) * influence * 2.2;
        heightField[idx] += delta;
        waterHeights[idx] = Math.min(waterHeights[idx], heightField[idx] - 0.8);
      }
    });

    mesas.forEach((cfg) => {
      const plateau = cfg.height;
      for (let idx = 0; idx < count; idx++) {
        const x = xzCoords[idx * 2];
        const z = xzCoords[idx * 2 + 1];
        const dx = x - cfg.x;
        const dz = z - cfg.z;
        const dist = Math.hypot(dx, dz);
        if (dist > cfg.radius) continue;
        const falloff = Math.pow(Math.max(0, 1 - dist / cfg.radius), 2.4);
        const target = Math.max(baseHeights[idx] + plateau, heightField[idx]);
        heightField[idx] = BABYLON.Scalar.Lerp(heightField[idx], target, falloff);
        waterHeights[idx] = Math.min(waterHeights[idx], heightField[idx] - 1.2 * falloff);
      }
    });
  }

  function sampleHeightFromField(x, z, heights, world) {
    const SUB = world.sub;
    const width = SUB + 1;
    const size = world.size;
    const step = size / SUB;
    const ox = -size / 2;
    const oz = -size / 2;
    const fx = (x - ox) / step;
    const fz = (z - oz) / step;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    if (ix < 0 || iz < 0 || ix >= SUB || iz >= SUB) return null;
    const tx = fx - ix;
    const tz = fz - iz;
    const idx00 = iz * width + ix;
    const idx10 = idx00 + 1;
    const idx01 = idx00 + width;
    const idx11 = idx01 + 1;
    const h00 = heights[idx00];
    const h10 = heights[idx10];
    const h01 = heights[idx01];
    const h11 = heights[idx11];
    if (tx + tz < 1) {
      return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    }
    return h11 + (h10 - h11) * (1 - tz) + (h01 - h11) * (1 - tx);
  }

  function generateRuins(scene, seeds, heights, world, material, landmarkMeshes) {
    seeds.ruins.forEach((ruin, idx) => {
      const y = sampleHeightFromField(ruin.x, ruin.z, heights, world);
      if (!isFinite(y)) return;
      const baseHeight = y + 0.3;
      const offsets = [
        [-2, -2], [2, -2], [-2, 2], [2, 2]
      ];
      offsets.forEach((off, i) => {
        const ox = ruin.x + off[0];
        const oz = ruin.z + off[1];
        const colHeight = 3.4 + (i % 2 ? 0.6 : -0.2);
        const column = BABYLON.MeshBuilder.CreateCylinder(`ruinCol${idx}_${i}`, { height: colHeight, diameter: 0.8 }, scene);
        column.position.set(ox, baseHeight + colHeight / 2, oz);
        column.rotation.y = ruin.yaw;
        column.material = material;
        landmarkMeshes.push(column);
      });
      const beam = BABYLON.MeshBuilder.CreateBox(`ruinBeam${idx}`, { width: 4.8, height: 0.5, depth: 0.7 }, scene);
      beam.position.set(ruin.x, baseHeight + 3.1, ruin.z);
      beam.rotation.y = ruin.yaw;
      beam.material = material;
      landmarkMeshes.push(beam);
    });
  }

  function createDefaultGroundMaterial(scene) {
    const mat = new BABYLON.StandardMaterial('groundMat', scene);
    const tex = new BABYLON.DynamicTexture('groundTex', { width: 512, height: 512 }, scene, false);
    const ctx = tex.getContext();
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#223f2a');
    grad.addColorStop(0.6, '#385c36');
    grad.addColorStop(1, '#6f5b3b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const r = Math.random() * 2 + 0.5;
      ctx.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.05})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    tex.update();
    tex.wrapU = tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.uScale = tex.vScale = 8;
    mat.diffuseTexture = tex;
    mat.specularColor = new BABYLON.Color3(0, 0, 0);
    mat.emissiveColor = new BABYLON.Color3(0.02, 0.05, 0.04);
    return mat;
  }

  function createDefaultWaterMaterial(scene) {
    BABYLON.Effect.ShadersStore = BABYLON.Effect.ShadersStore || {};
    BABYLON.Effect.ShadersStore.riverVertexShader = `
      precision highp float;
      attribute vec3 position;
      attribute vec2 uv;
      uniform mat4 worldViewProjection;
      uniform float time;
      varying vec2 vUV;
      void main(){
        vec3 pos = position;
        float wave = sin(uv.x*14.0 + time*0.7) * 0.08 + cos(uv.y*18.0 + time*0.5) * 0.05;
        pos.y += wave;
        vUV = uv;
        gl_Position = worldViewProjection * vec4(pos,1.0);
      }
    `;
    BABYLON.Effect.ShadersStore.riverFragmentShader = `
      precision highp float;
      varying vec2 vUV;
      uniform float time;
      void main(){
        float ripple = sin((vUV.x+vUV.y+time*0.3)*24.0)*0.05;
        vec3 base = vec3(0.05, 0.22, 0.28);
        vec3 highlight = vec3(0.15, 0.4, 0.55);
        vec3 color = mix(base, highlight, 0.5 + ripple);
        gl_FragColor = vec4(color, 0.65);
      }
    `;
    const mat = new BABYLON.ShaderMaterial('waterMat', scene, { vertex: 'river', fragment: 'river' }, {
      attributes: ['position', 'uv'],
      uniforms: ['worldViewProjection', 'time'],
      needAlphaBlending: true
    });
    mat.backFaceCulling = false;
    mat.setFloat('time', 0);
    return mat;
  }

  function createDefaultRuinMaterial(scene) {
    const mat = new BABYLON.StandardMaterial('ruinMat', scene);
    mat.diffuseColor = new BABYLON.Color3(0.45, 0.4, 0.34);
    mat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    mat.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.02);
    return mat;
  }

  function createWorldGenerator(scene, config = {}) {
    const world = Object.assign({ size: 240, sub: 160, height: 18, flat: 0.6 }, config);
    let ground = null;
    let water = null;
    let groundPositions = null;
    let heightField = null;
    let sampler = null;
    let seeds = null;
    let waterMaterial = null;
    let waterUpdater = null;
    let waterTime = 0;
    let ruinMaterial = null;
    const landmarkMeshes = [];

    function disposeLandmarks() {
      while (landmarkMeshes.length) {
        const mesh = landmarkMeshes.pop();
        try { mesh.dispose(); } catch (err) { console.warn('dispose landmark', err); }
      }
    }

    function groundHeightAt(x, z) {
      if (!groundPositions) return 0;
      const SUB = world.sub;
      const width = SUB + 1;
      const size = world.size;
      const step = size / SUB;
      const ox = -size / 2;
      const oz = -size / 2;
      const fx = (x - ox) / step;
      const fz = (z - oz) / step;
      const ix = Math.floor(fx);
      const iz = Math.floor(fz);
      if (ix < 0 || iz < 0 || ix >= SUB || iz >= SUB) return 0;
      const tx = fx - ix;
      const tz = fz - iz;
      const i00 = (iz * width + ix) * 3;
      const i10 = i00 + 3;
      const i01 = ((iz + 1) * width + ix) * 3;
      const i11 = i01 + 3;
      const yh = (i) => groundPositions[i + 1];
      if (tx + tz < 1) {
        return yh(i00) + (yh(i10) - yh(i00)) * tx + (yh(i01) - yh(i00)) * tz + 1.6;
      }
      return yh(i11) + (yh(i10) - yh(i11)) * (1 - tz) + (yh(i01) - yh(i11)) * (1 - tx) + 1.6;
    }

    function pickSpawn(rng = mulberry32((world.seed >>> 0) ^ 0xdeadc0de)) {
      for (let n = 0; n < 200; n++) {
        const x = (rng() - 0.5) * world.size * 0.6;
        const z = (rng() - 0.5) * world.size * 0.6;
        const y = groundHeightAt(x, z);
        if (isFinite(y)) {
          return new BABYLON.Vector3(x, y, z);
        }
      }
      return new BABYLON.Vector3(0, groundHeightAt(0, 0), 0);
    }

    function build(seed, hooks = {}) {
      world.seed = seed >>> 0;
      sampler = heightFuncFactory(world, world.seed);
      seeds = landmarkSeeds(world.seed, world);
      disposeLandmarks();
      waterTime = 0;

      if (ground) {
        try { ground.material?.dispose(); } catch (err) { console.warn('dispose ground material', err); }
        try { ground.dispose(); } catch (err) { console.warn('dispose ground', err); }
        ground = null;
      }

      const SIZE = world.size;
      const SUB = world.sub;
      const mesh = BABYLON.MeshBuilder.CreateGround('ground', { width: SIZE, height: SIZE, subdivisions: SUB, updatable: true }, scene);
      const vertexPositions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      const vertexCount = vertexPositions.length / 3;
      const baseHeights = new Float32Array(vertexCount);
      const finalHeights = new Float32Array(vertexCount);
      const waterHeights = new Float32Array(vertexCount);
      const xzCoords = new Float32Array(vertexCount * 2);
      const gradStep = (SIZE / SUB) * 0.6;

      for (let idx = 0; idx < vertexCount; idx++) {
        const i = idx * 3;
        const x = vertexPositions[i];
        const z = vertexPositions[i + 2];
        xzCoords[idx * 2] = x;
        xzCoords[idx * 2 + 1] = z;
        const s = sampler.sample(x, z);
        let height = s.height;
        baseHeights[idx] = height;

        const samplePX = sampler.sample(x + gradStep, z).height;
        const sampleMX = sampler.sample(x - gradStep, z).height;
        const samplePZ = sampler.sample(x, z + gradStep).height;
        const sampleMZ = sampler.sample(x, z - gradStep).height;
        const gradX = samplePX - sampleMX;
        const gradZ = samplePZ - sampleMZ;
        const gradLen = Math.hypot(gradX, gradZ);

        let accumulation = 0;
        if (gradLen > 1e-4) {
          const dirX = -gradX / gradLen;
          const dirZ = -gradZ / gradLen;
          let px = x;
          let pz = z;
          for (let step = 0; step < 4; step++) {
            const here = sampler.sample(px, pz).height;
            px += dirX * gradStep;
            pz += dirZ * gradStep;
            const ahead = sampler.sample(px, pz).height;
            accumulation += Math.max(0, here - ahead);
          }
        }
        const riverStrength = BABYLON.Scalar.Clamp(accumulation * 0.35, 0, 1);
        const erosionDepth = (0.6 + s.erosion * 1.4) * riverStrength;
        height -= erosionDepth;

        let waterLevel = s.water;
        if (riverStrength > 0.05) {
          waterLevel = Math.min(height - 0.05, s.water + riverStrength * 1.4);
        } else if (waterLevel > height - 0.2) {
          waterLevel = height - 0.2;
        } else if (waterLevel < height - 0.6) {
          waterLevel = height - 3;
        }

        finalHeights[idx] = height;
        waterHeights[idx] = waterLevel;
      }

      applyLandmarks(finalHeights, baseHeights, waterHeights, xzCoords, seeds);

      for (let idx = 0; idx < vertexCount; idx++) {
        const i = idx * 3;
        const height = finalHeights[idx];
        vertexPositions[i + 1] = height;
        waterHeights[idx] = Math.min(waterHeights[idx], height - 0.05);
      }

      mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, vertexPositions);
      mesh.convertToFlatShadedMesh();
      groundPositions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      heightField = finalHeights;
      mesh.freezeWorldMatrix();

      let groundMaterial = null;
      if (typeof hooks.groundMaterialFactory === 'function') {
        try {
          groundMaterial = hooks.groundMaterialFactory(scene, world, { sampler, seeds, baseHeights, finalHeights });
        } catch (err) {
          console.warn('groundMaterialFactory error', err);
        }
      }
      if (!(groundMaterial instanceof BABYLON.Material)) {
        groundMaterial = createDefaultGroundMaterial(scene);
      }
      mesh.material = groundMaterial;
      ground = mesh;

      if (!water || water.getVerticesData(BABYLON.VertexBuffer.PositionKind).length !== vertexPositions.length) {
        try { water?.dispose(); } catch (err) { console.warn('dispose water', err); }
        water = BABYLON.MeshBuilder.CreateGround('water', { width: SIZE, height: SIZE, subdivisions: SUB, updatable: true }, scene);
        water.isPickable = false;
        water.renderingGroupId = 1;
      }
      const waterData = water.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      for (let idx = 0; idx < vertexCount; idx++) {
        const i = idx * 3;
        waterData[i] = xzCoords[idx * 2];
        const wy = waterHeights[idx];
        waterData[i + 1] = isFinite(wy) ? wy : finalHeights[idx] - 3;
        waterData[i + 2] = xzCoords[idx * 2 + 1];
      }
      water.updateVerticesData(BABYLON.VertexBuffer.PositionKind, waterData);
      water.refreshBoundingInfo();

      let customWater = null;
      if (typeof hooks.waterMaterialFactory === 'function') {
        try {
          customWater = hooks.waterMaterialFactory(scene, world, { sampler, seeds, previous: waterMaterial });
        } catch (err) {
          console.warn('waterMaterialFactory error', err);
        }
      }
      if (customWater && customWater.material instanceof BABYLON.Material) {
        if (customWater.material !== waterMaterial) {
          try { waterMaterial?.dispose?.(); } catch (err) { console.warn('dispose old water material', err); }
        }
        waterMaterial = customWater.material;
        waterUpdater = typeof customWater.update === 'function' ? customWater.update : null;
      }
      if (!waterMaterial) {
        waterMaterial = createDefaultWaterMaterial(scene);
        waterUpdater = (dt, material, time) => material.setFloat('time', time);
      }
      water.material = waterMaterial;
      if (!waterUpdater) {
        waterUpdater = (dt, material, time) => {
          if (material.setFloat) material.setFloat('time', time);
        };
      }
      waterUpdater(0, waterMaterial, waterTime);

      if (typeof hooks.ruinMaterialFactory === 'function') {
        try {
          const mat = hooks.ruinMaterialFactory(scene, world, { seeds, sampler, previous: ruinMaterial });
          if (mat instanceof BABYLON.Material && mat !== ruinMaterial) {
            try { ruinMaterial?.dispose(); } catch (err) { console.warn('dispose ruin material', err); }
            ruinMaterial = mat;
          }
        } catch (err) {
          console.warn('ruinMaterialFactory error', err);
        }
      }
      if (!ruinMaterial) {
        ruinMaterial = createDefaultRuinMaterial(scene);
      }
      generateRuins(scene, seeds, finalHeights, world, ruinMaterial, landmarkMeshes);

      return { ground, water, seeds, sampler, heights: finalHeights, baseHeights, waterHeights, xzCoords };
    }

    function update(dt) {
      if (!waterMaterial || typeof dt !== 'number') return;
      waterTime += dt;
      if (waterUpdater) {
        try { waterUpdater(dt, waterMaterial, waterTime); } catch (err) { console.warn('water update error', err); }
      }
    }

    function dispose() {
      disposeLandmarks();
      try { ground?.material?.dispose(); } catch (err) { console.warn('dispose ground mat', err); }
      try { ground?.dispose(); } catch (err) { console.warn('dispose ground mesh', err); }
      try { waterMaterial?.dispose?.(); } catch (err) { console.warn('dispose water mat', err); }
      try { water?.dispose(); } catch (err) { console.warn('dispose water mesh', err); }
      try { ruinMaterial?.dispose(); } catch (err) { console.warn('dispose ruin mat', err); }
      ground = null;
      water = null;
      groundPositions = null;
      heightField = null;
      sampler = null;
      seeds = null;
    }

    return {
      world,
      build,
      update,
      dispose,
      groundHeightAt,
      pickSpawn,
      getGroundMesh: () => ground,
      getWaterMesh: () => water,
      getSampler: () => sampler,
      getSeeds: () => seeds,
      getHeightField: () => heightField
    };
  }

  global.WorldGen = {
    createWorldGenerator,
    heightFuncFactory,
    landmarkSeeds,
    applyLandmarks,
    mulberry32,
    newSeed
  };
})(typeof window !== 'undefined' ? window : globalThis);

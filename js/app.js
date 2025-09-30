import { APP_VERSION, LS_SETTINGS_KEY, LS_WORLD_KEY } from './constants.js';
import { safeLoad, safeSave } from './storage.js';
import { mulberry32, newSeed } from './random.js';
import { createHeightSampler, createTerrainTileBuilder } from './terrain.js';
import { WorldStreamer } from './worldStreamer.js';

const defaults = {
  invertX: false,
  invertY: false,
  sens: 0.002,
  touchLookScale: 12,
  moveSpeed: 8.0,
  rmbForward: true,
  quality: 'medium',
  sky: true,
  treeCount: 30,
};

const worldConfig = {
  size: 240,
  subdivisions: 160,
  height: 18,
  flatten: 0.6,
  radius: 2,
};

function makeGroundTexture(scene, config, sampler, size = 512) {
  const tex = new BABYLON.DynamicTexture('ground', { width: size, height: size }, scene, false);
  const ctx = tex.getContext();
  let heights = null;
  if (sampler && typeof sampler.fillHeightMap === 'function') {
    try {
      heights = sampler.fillHeightMap({
        width: size,
        height: size,
        originX: -config.size * 0.5,
        originZ: -config.size * 0.5,
        stepX: config.size / (size - 1),
        stepZ: config.size / (size - 1),
      });
    } catch (err) {
      console.warn('Failed to generate texture height map', err);
    }
  }
  const imageData = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const h = heights ? heights[y * size + x] / config.height : Math.random();
      const shade = Math.floor(90 + h * 80);
      imageData.data[idx + 0] = shade * 0.6;
      imageData.data[idx + 1] = shade * 0.8;
      imageData.data[idx + 2] = shade * 0.4;
      imageData.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  tex.update(false);
  return tex;
}

function setupVersionLabel() {
  const versionEl = document.getElementById('helpVersion');
  if (versionEl) {
    versionEl.textContent = `Version ${APP_VERSION}`;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  setupVersionLabel();

  const settings = Object.assign({}, defaults, safeLoad(LS_SETTINGS_KEY, {}));
  const worldState = Object.assign({ seed: newSeed() }, safeLoad(LS_WORLD_KEY, {}));
  safeSave(LS_WORLD_KEY, worldState);

  const canvas = document.getElementById('renderCanvas');
  const engine = new BABYLON.Engine(canvas, true);
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.53, 0.81, 0.92, 1.0);
  if (settings.quality === 'high') engine.setHardwareScalingLevel(1);
  else if (settings.quality === 'medium') engine.setHardwareScalingLevel(1.5);
  else engine.setHardwareScalingLevel(2);

  const cam = new BABYLON.UniversalCamera('cam', new BABYLON.Vector3(0, 6, -10), scene);
  cam.minZ = 0.1;
  cam.maxZ = 2000;
  cam.speed = 0.8;
  cam.inertia = 0;
  cam.angularSensibility = 2000;
  cam.attachControl(canvas, true);
  cam.applyGravity = false;
  cam.checkCollisions = false;
  cam.inputs.clear();
  scene.activeCamera = cam;

  new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0.2, 1, 0.2), scene);
  const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -2, -1), scene);
  sun.intensity = 1.0;

  let heightSampler = createHeightSampler(worldConfig, worldState.seed);
  const terrainMaterial = new BABYLON.StandardMaterial('ground', scene);
  terrainMaterial.diffuseTexture = makeGroundTexture(scene, worldConfig, heightSampler);
  terrainMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
  terrainMaterial.backFaceCulling = true;

  const sky = BABYLON.MeshBuilder.CreateSphere('sky', { diameter: 800, segments: 32 }, scene);
  const skyMaterial = new BABYLON.StandardMaterial('skyMat', scene);
  skyMaterial.backFaceCulling = false;
  skyMaterial.disableLighting = true;
  skyMaterial.diffuseColor = new BABYLON.Color3(0.53, 0.81, 0.92);
  skyMaterial.emissiveColor = new BABYLON.Color3(0.53, 0.81, 0.92);
  sky.material = skyMaterial;
  sky.isPickable = false;

  const terrainBuilder = createTerrainTileBuilder(
    scene,
    worldConfig,
    () => heightSampler,
    terrainMaterial
  );

  const worldStreamer = new WorldStreamer(scene, cam, {
    size: worldConfig.size,
    radius: worldConfig.radius,
    buildTile: terrainBuilder.buildTile,
  });

  const groundHeightAt = (x, z) => {
    const height = terrainBuilder.sampleHeight(x, z);
    return height !== null ? height + 2.8 : 6;
  };

  const groundMaterial = terrainMaterial;

  const trunkBase = BABYLON.MeshBuilder.CreateCylinder('trunkBase', { height: 3, diameter: 0.4 }, scene);
  trunkBase.isVisible = false;
  trunkBase.isPickable = false;
  const trunkMaterial = new BABYLON.StandardMaterial('trunkMat', scene);
  trunkMaterial.diffuseColor = new BABYLON.Color3(0.35, 0.2, 0.05);
  trunkMaterial.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  trunkBase.material = trunkMaterial;

  const leavesBase = BABYLON.MeshBuilder.CreateSphere('leavesBase', { diameter: 5, segments: 8 }, scene);
  leavesBase.isVisible = false;
  leavesBase.isPickable = false;
  const leavesMaterial = new BABYLON.StandardMaterial('leavesMat', scene);
  leavesMaterial.diffuseColor = new BABYLON.Color3(0.15, 0.35, 0.1);
  leavesMaterial.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  leavesBase.material = leavesMaterial;

  let treeInstances = [];
  const clearTrees = () => {
    for (const mesh of treeInstances) {
      mesh.dispose();
    }
    treeInstances = [];
  };

  const createTree = (x, z) => {
    const terrainY = terrainBuilder.sampleHeight(x, z);
    if (terrainY == null) return null;
    if (terrainY < 2) return null;
    const trunk = trunkBase.createInstance('trunk');
    const leaves = leavesBase.createInstance('leaves');
    trunk.position.set(x, terrainY + 1.5, z);
    leaves.position.set(x, terrainY + 5, z);
    treeInstances.push(trunk, leaves);
    return [trunk, leaves];
  };

  const scatterTrees = (count) => {
    clearTrees();
    const rnd = mulberry32(worldState.seed ^ 0x85ebca6b);
    for (let i = 0; i < count; i++) {
      const x = (rnd() - 0.5) * worldConfig.size * 0.75;
      const z = (rnd() - 0.5) * worldConfig.size * 0.75;
      createTree(x, z);
    }
    safeSave(LS_WORLD_KEY, worldState);
  };

  scatterTrees(settings.treeCount);

  const inputMap = {};
  scene.actionManager = new BABYLON.ActionManager(scene);
  scene.actionManager.registerAction(
    new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyDownTrigger, (evt) => {
      inputMap[evt.sourceEvent.code] = true;
    })
  );
  scene.actionManager.registerAction(
    new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyUpTrigger, (evt) => {
      inputMap[evt.sourceEvent.code] = false;
    })
  );
  window.addEventListener(
    'keydown',
    (e) => {
      if ([
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Space',
      ].includes(e.code)) {
        e.preventDefault();
      }
    },
    { passive: false }
  );

  let lmb = false;
  let rmb = false;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const rotateByDelta = (dx, dy) => {
    const sx = (settings.invertX ? -1 : 1) * settings.sens;
    const sy = (settings.invertY ? -1 : 1) * settings.sens;
    cam.rotation.y += dx * sx;
    cam.rotation.x = BABYLON.Scalar.Clamp(
      cam.rotation.x + dy * sy,
      -Math.PI / 2,
      Math.PI / 2
    );
  };
  const syncButtons = (buttons) => {
    lmb = (buttons & 1) === 1;
    rmb = settings.rmbForward && (buttons & 2) === 2;
    dragging = lmb;
    canvas.style.cursor = dragging ? 'none' : 'crosshair';
  };

  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'mouse') {
        syncButtons(e.buttons | (1 << e.button));
        lastX = e.clientX;
        lastY = e.clientY;
        e.preventDefault();
      }
    },
    { passive: false }
  );
  document.addEventListener(
    'pointerup',
    (e) => {
      if (e.pointerType === 'mouse') syncButtons(e.buttons & ~(1 << e.button));
    },
    { capture: true }
  );
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      syncButtons(e.buttons);
      if (dragging) {
        const dx = typeof e.movementX === 'number' ? e.movementX : e.clientX - lastX;
        const dy = typeof e.movementY === 'number' ? e.movementY : e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        rotateByDelta(dx, dy);
      }
    }
  });
  window.addEventListener('blur', () => {
    lmb = false;
    rmb = false;
    dragging = false;
    canvas.style.cursor = 'crosshair';
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault(), { capture: true });

  let moveTouchId = null;
  let lookTouchId = null;
  let moveVecX = 0;
  let moveVecY = 0;
  const stickRadius = 80;
  const origin = { mx: 0, my: 0, lx: 0, ly: 0 };
  const touchVec = (ox, oy, x, y) => {
    const dx = x - ox;
    const dy = y - oy;
    const len = Math.hypot(dx, dy) || 1;
    const cl = Math.min(len, stickRadius);
    return {
      x: (dx / len) * cl / stickRadius,
      y: (dy / len) * cl / stickRadius,
    };
  };
  canvas.addEventListener(
    'touchstart',
    (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth * 0.5 && moveTouchId === null) {
          moveTouchId = t.identifier;
          origin.mx = t.clientX;
          origin.my = t.clientY;
          moveVecX = 0;
          moveVecY = 0;
        } else if (lookTouchId === null) {
          lookTouchId = t.identifier;
          origin.lx = t.clientX;
          origin.ly = t.clientY;
        }
      }
    },
    { passive: false }
  );
  canvas.addEventListener(
    'touchmove',
    (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === moveTouchId) {
          const v = touchVec(origin.mx, origin.my, t.clientX, t.clientY);
          moveVecX = v.x;
          moveVecY = -v.y;
        } else if (t.identifier === lookTouchId) {
          const v = touchVec(origin.lx, origin.ly, t.clientX, t.clientY);
          rotateByDelta(v.x * settings.touchLookScale, v.y * settings.touchLookScale);
        }
      }
      e.preventDefault();
    },
    { passive: false }
  );
  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === moveTouchId) {
        moveTouchId = null;
        moveVecX = 0;
        moveVecY = 0;
      }
      if (t.identifier === lookTouchId) {
        lookTouchId = null;
      }
    }
  };
  canvas.addEventListener('touchend', endTouch);
  canvas.addEventListener('touchcancel', endTouch);

  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(engine.getDeltaTime() * 0.001, 0.05);
    const move = settings.moveSpeed * dt;
    const sinY = Math.sin(cam.rotation.y);
    const cosY = Math.cos(cam.rotation.y);
    const forward = new BABYLON.Vector3(sinY, 0, cosY);
    const right = new BABYLON.Vector3(cosY, 0, -sinY);
    let dx = 0;
    let dz = 0;
    if (inputMap['KeyA'] || inputMap['ArrowLeft']) dx -= 1;
    if (inputMap['KeyD'] || inputMap['ArrowRight']) dx += 1;
    if (inputMap['KeyW'] || inputMap['ArrowUp'] || rmb) dz += 1;
    if (inputMap['KeyS'] || inputMap['ArrowDown']) dz -= 1;
    dx += moveVecX;
    dz += moveVecY;
    if (dx !== 0 || dz !== 0) {
      const len = Math.hypot(dx, dz);
      dx /= len;
      dz /= len;
      cam.position.addInPlace(right.scale(dx * move)).addInPlace(forward.scale(dz * move));
    }
    worldStreamer.update();
    const targetY = groundHeightAt(cam.position.x, cam.position.z);
    if (cam.position.y < targetY) {
      cam.position.y = targetY;
    } else {
      cam.position.y = BABYLON.Scalar.Lerp(cam.position.y, targetY, 0.35);
    }
    sky.setEnabled(settings.sky);
  });

  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());

  const $ = (id) => document.getElementById(id);
  const panel = $('panel');
  const btn = $('optsBtn');
  const bind = () => {
    $('optInvertX').checked = settings.invertX;
    $('optInvertY').checked = settings.invertY;
    $('optSens').value = settings.sens;
    $('sensVal').textContent = settings.sens.toFixed(3);
    $('optSpeed').value = settings.moveSpeed;
    $('speedVal').textContent = settings.moveSpeed.toFixed(1);
    $('optRmb').checked = settings.rmbForward;
    $('optQuality').value = settings.quality;
    $('optSky').checked = settings.sky;
    $('optTrees').value = settings.treeCount;
    $('treesVal').textContent = settings.treeCount;
    $('seedBox').value = String(worldState.seed);
  };
  bind();

  const persist = () => safeSave(LS_SETTINGS_KEY, settings);
  btn.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' || !panel.style.display ? 'block' : 'none';
  });
  $('optInvertX').addEventListener('change', (e) => {
    settings.invertX = e.target.checked;
    persist();
  });
  $('optInvertY').addEventListener('change', (e) => {
    settings.invertY = e.target.checked;
    persist();
  });
  $('optSens').addEventListener('input', (e) => {
    settings.sens = parseFloat(e.target.value);
    $('sensVal').textContent = settings.sens.toFixed(3);
    persist();
  });
  $('optSpeed').addEventListener('input', (e) => {
    settings.moveSpeed = parseFloat(e.target.value);
    $('speedVal').textContent = settings.moveSpeed.toFixed(1);
    persist();
  });
  $('optRmb').addEventListener('change', (e) => {
    settings.rmbForward = e.target.checked;
    if (!settings.rmbForward) rmb = false;
    persist();
  });
  $('optQuality').addEventListener('change', (e) => {
    settings.quality = e.target.value;
    persist();
    if (settings.quality === 'high') engine.setHardwareScalingLevel(1);
    else if (settings.quality === 'medium') engine.setHardwareScalingLevel(1.5);
    else engine.setHardwareScalingLevel(2);
  });
  $('optSky').addEventListener('change', (e) => {
    settings.sky = e.target.checked;
    persist();
  });
  $('optTrees').addEventListener('input', (e) => {
    settings.treeCount = parseInt(e.target.value, 10);
    $('treesVal').textContent = settings.treeCount;
    persist();
  });
  $('btnRegenTrees').addEventListener('click', () => {
    scatterTrees(settings.treeCount);
  });
  $('btnRegenGround').addEventListener('click', () => {
    groundMaterial.diffuseTexture?.dispose();
    groundMaterial.diffuseTexture = makeGroundTexture(scene, worldConfig, heightSampler);
  });
  $('btnFullscreen').addEventListener('click', async () => {
    try {
      await (document.documentElement.requestFullscreen?.() || Promise.reject());
    } catch {
      // Ignore fullscreen errors (likely due to user gesture requirements).
    }
  });
  $('btnApplySeed').addEventListener('click', () => {
    const n = Number($('seedBox').value);
    if (Number.isFinite(n) && n >= 0 && n <= 0xFFFFFFFF) {
      worldState.seed = n >>> 0;
      heightSampler = createHeightSampler(worldConfig, worldState.seed);
      terrainBuilder.clearCache();
      groundMaterial.diffuseTexture?.dispose();
      groundMaterial.diffuseTexture = makeGroundTexture(scene, worldConfig, heightSampler);
      scatterTrees(settings.treeCount);
      safeSave(LS_WORLD_KEY, worldState);
      worldStreamer.rebuildActive();
      worldStreamer.update(true);
    }
  });
  $('btnNewSeed').addEventListener('click', () => {
    worldState.seed = newSeed();
    $('seedBox').value = String(worldState.seed);
    heightSampler = createHeightSampler(worldConfig, worldState.seed);
    terrainBuilder.clearCache();
    groundMaterial.diffuseTexture?.dispose();
    groundMaterial.diffuseTexture = makeGroundTexture(scene, worldConfig, heightSampler);
    scatterTrees(settings.treeCount);
    safeSave(LS_WORLD_KEY, worldState);
    worldStreamer.rebuildActive();
    worldStreamer.update(true);
  });

  const helpBtn = document.getElementById('helpBtn');
  const helpDialog = document.getElementById('helpDialog');
  const closeHelp = document.getElementById('closeHelp');
  helpBtn.addEventListener('click', () => {
    helpDialog.style.display = 'block';
  });
  closeHelp.addEventListener('click', () => {
    helpDialog.style.display = 'none';
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') helpDialog.style.display = 'none';
  });

  const testsEl = document.getElementById('tests');
  const tests = [];
  const test = (name, fn) => {
    try {
      if (fn() === false) throw new Error('assert');
      tests.push(['PASS', name]);
    } catch (err) {
      tests.push(['FAIL', name, err?.message || String(err)]);
    }
  };
  test('Engine live', () => typeof BABYLON !== 'undefined' && engine && scene && canvas);
  test('UI present', () => document.getElementById('optsBtn') && document.getElementById('helpBtn'));
  test('Persistence wired', () => typeof localStorage !== 'undefined');
  test('Streamer active', () => worldStreamer && worldStreamer.activeCount() > 0);
  testsEl.textContent = tests.map((t) => `${t[0]} — ${t[1]}${t[2] ? ': ' + t[2] : ''}`).join('\n');
  console.table(tests);
});

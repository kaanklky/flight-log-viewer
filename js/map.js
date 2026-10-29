import * as THREE from 'three';
import { lerpAngle, clamp } from './geo.js';
import { buildEasyGlider, SPAN } from './aircraft.js';

const IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const METERS_PER_PIXEL_Z0 = 78271.517;
const TRAIL_RADIAL = 4;
const TRAIL_RADIUS_PX = 2.2;
const AIRCRAFT_SPAN_PX = 96;
const TRACK_STEP = 0.25;
const PROP_MAX_RATE = 90;

export const CAMERA_MODES = ['chase', 'tail', 'orbit', 'cinematic', 'topdown', 'manual'];

const RAMPS = {
  speed: ['#2f6fd6', '#2fb7e0', '#4fd6a3', '#f2d04a', '#f2813a', '#e5484d'],
  altitude: ['#3b4cc0', '#5a8fe0', '#6fd0c9', '#b6e07a', '#f7d65a', '#f48a45'],
  battery: ['#e5484d', '#f2813a', '#f2d04a', '#7fd96a', '#2fcf8a']
};

function rampColor(name, f) {
  const stops = RAMPS[name].map(h => new THREE.Color(h));
  const x = clamp(f, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return stops[i].clone().lerp(stops[i + 1], x - i);
}

function buildOffsets(points) {
  const n = points.length;
  const frames = [];
  let prevT = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const t = new THREE.Vector3().subVectors(b, a);
    if (t.lengthSq() < 1e-9) t.copy(prevT);
    t.normalize();
    prevT = t;
    const up = Math.abs(t.z) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const nrm = new THREE.Vector3().crossVectors(t, up).normalize();
    const bin = new THREE.Vector3().crossVectors(t, nrm).normalize();
    frames.push([nrm, bin]);
  }
  return frames;
}

function ringOffsets(nrm, bin) {
  return [nrm.clone(), bin.clone(), nrm.clone().negate(), bin.clone().negate()];
}

class TrailMaterialFactory {
  static make(alpha) {
    return new THREE.ShaderMaterial({
      uniforms: { uRadius: { value: 1 }, uAlpha: { value: alpha } },
      vertexShader: `
        uniform float uRadius;
        attribute vec3 offset;
        attribute vec3 aColor;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          vec3 p = position + offset * uRadius;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uAlpha;
        varying vec3 vColor;
        void main() {
          gl_FragColor = vec4(vColor, uAlpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });
  }
}

class TrailLayer {
  constructor(map) {
    this.id = 'flight-trail';
    this.type = 'custom';
    this.renderingMode = '3d';
    this.mapRef = map;
    this.log = null;
    this.track = null;
    this.ground = 0;
    this.colorMode = 'speed';
    this.altMode = 'msl';
    this.pose = null;
    this.propAngle = 0;
  }

  onAdd(map, gl) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
    this.scene = new THREE.Scene();
    this.world = new THREE.Group();
    this.world.scale.set(1, -1, 1);
    this.scene.add(this.world);
    this.camera = new THREE.Camera();
    this.ghostMaterial = TrailMaterialFactory.make(0.4);
    this.liveMaterial = TrailMaterialFactory.make(1);
    this.liveMaterial.depthWrite = true;
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.35));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(0.5, -0.6, 1);
    this.world.add(sun);
    const model = buildEasyGlider();
    this.aircraft = new THREE.Group();
    this.aircraft.rotation.order = 'ZXY';
    this.aircraft.add(model.group);
    this.prop = model.prop;
    this.disc = model.discMat;
    this.world.add(this.aircraft);
    this.dropLine = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })
    );
    this.dropLine.frustumCulled = false;
    this.world.add(this.dropLine);
    this.aircraft.visible = false;
    this.dropLine.visible = false;
    this.local = new THREE.Matrix4();
    if (this.log) this.rebuild();
  }

  onRemove() {
    for (const m of [this.ghost, this.live, this.head]) if (m) m.geometry.dispose();
  }

  setLog(log, path, ground) {
    this.log = log;
    this.path = path;
    this.track = path.track(TRACK_STEP);
    this.ground = ground;
    this.pose = null;
    if (this.scene) this.rebuild();
  }

  zOf(alt) {
    if (this.altMode === 'launch') return this.ground + alt - this.log.launchAlt;
    return alt;
  }

  setAltMode(mode) {
    this.altMode = mode;
    if (this.log && this.scene) this.rebuild();
  }

  setGround(ground) {
    if (Math.abs(ground - this.ground) < 0.5) return;
    this.ground = ground;
    if (this.altMode === 'launch' && this.log && this.scene) this.rebuild();
  }

  setColorMode(mode) {
    this.colorMode = mode;
    if (this.log && this.scene) this.rebuild();
  }

  clear() {
    this.log = null;
    this.track = null;
    this.pose = null;
    if (!this.scene) return;
    for (const m of [this.ghost, this.live, this.head]) {
      if (m) {
        this.world.remove(m);
        m.geometry.dispose();
      }
    }
    this.ghost = this.live = this.head = null;
    this.aircraft.visible = false;
    this.dropLine.visible = false;
  }

  colorFor(s, stats) {
    if (this.colorMode === 'altitude') return rampColor('altitude', (s.alt - stats.minAlt) / Math.max(1, stats.maxAlt - stats.minAlt));
    if (this.colorMode === 'battery') {
      const f = s.vcell === null ? 1 : (s.vcell - 3.3) / (4.2 - 3.3);
      return rampColor('battery', f);
    }
    return rampColor('speed', s.speed / Math.max(10, stats.maxSpeed));
  }

  rebuild() {
    for (const m of [this.ghost, this.live]) {
      if (m) {
        this.world.remove(m);
        m.geometry.dispose();
      }
    }
    const track = this.track;
    const n = track.length;
    this.points = track.map(s => new THREE.Vector3(s.east, s.north, this.zOf(s.alt)));
    const frames = buildOffsets(this.points);
    this.frames = frames;
    const stats = {
      minAlt: Math.min(...track.map(s => s.alt)),
      maxAlt: Math.max(...track.map(s => s.alt)),
      maxSpeed: Math.max(...track.map(s => s.speed))
    };
    const pos = new Float32Array(n * TRAIL_RADIAL * 3);
    const off = new Float32Array(n * TRAIL_RADIAL * 3);
    const col = new Float32Array(n * TRAIL_RADIAL * 3);
    for (let i = 0; i < n; i++) {
      const offsets = ringOffsets(frames[i][0], frames[i][1]);
      const c = this.colorFor(track[i], stats);
      for (let k = 0; k < TRAIL_RADIAL; k++) {
        const at = (i * TRAIL_RADIAL + k) * 3;
        pos[at] = this.points[i].x;
        pos[at + 1] = this.points[i].y;
        pos[at + 2] = this.points[i].z;
        off[at] = offsets[k].x;
        off[at + 1] = offsets[k].y;
        off[at + 2] = offsets[k].z;
        col[at] = c.r;
        col[at + 1] = c.g;
        col[at + 2] = c.b;
      }
    }
    const index = [];
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < TRAIL_RADIAL; k++) {
        const a = i * TRAIL_RADIAL + k;
        const b = i * TRAIL_RADIAL + ((k + 1) % TRAIL_RADIAL);
        const c = (i + 1) * TRAIL_RADIAL + k;
        const d = (i + 1) * TRAIL_RADIAL + ((k + 1) % TRAIL_RADIAL);
        index.push(a, b, c, b, d, c);
      }
    }
    const make = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('offset', new THREE.BufferAttribute(off, 3));
      g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      g.setIndex(index);
      return g;
    };
    this.ghost = new THREE.Mesh(make(), this.ghostMaterial);
    this.live = new THREE.Mesh(make(), this.liveMaterial);
    this.ghost.frustumCulled = false;
    this.live.frustumCulled = false;
    this.ghost.renderOrder = 1;
    this.live.renderOrder = 2;
    this.world.add(this.ghost, this.live);
    if (!this.head) {
      const hg = new THREE.BufferGeometry();
      hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * TRAIL_RADIAL * 3), 3));
      hg.setAttribute('offset', new THREE.BufferAttribute(new Float32Array(2 * TRAIL_RADIAL * 3), 3));
      hg.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(2 * TRAIL_RADIAL * 3), 3));
      const hi = [];
      for (let k = 0; k < TRAIL_RADIAL; k++) {
        const a = k;
        const b = (k + 1) % TRAIL_RADIAL;
        const c = TRAIL_RADIAL + k;
        const d = TRAIL_RADIAL + ((k + 1) % TRAIL_RADIAL);
        hi.push(a, b, c, b, d, c);
      }
      hg.setIndex(hi);
      this.head = new THREE.Mesh(hg, this.liveMaterial);
      this.head.frustumCulled = false;
      this.head.renderOrder = 2;
      this.world.add(this.head);
    }
    this.applyProgress(0);
    this.map.triggerRepaint();
  }

  setPose(state, dt) {
    this.pose = state;
    if (!this.log || !this.scene) return;
    this.applyProgress(dt);
    this.map.triggerRepaint();
  }

  applyProgress(dt) {
    if (!this.pose || !this.live) return;
    const n = this.track.length;
    const i = Math.min(n - 2, Math.floor(this.pose.t / TRACK_STEP));
    this.live.geometry.setDrawRange(0, i * TRAIL_RADIAL * 6);
    this.current = new THREE.Vector3(this.pose.east, this.pose.north, this.zOf(this.pose.alt));
    const p0 = this.points[i];
    const hg = this.head.geometry;
    const pa = hg.getAttribute('position');
    const oa = hg.getAttribute('offset');
    const ca = hg.getAttribute('aColor');
    const srcCol = this.live.geometry.getAttribute('aColor');
    const srcOff = this.live.geometry.getAttribute('offset');
    const j = i + 1;
    for (let k = 0; k < TRAIL_RADIAL; k++) {
      const a = k * 3;
      const b = (TRAIL_RADIAL + k) * 3;
      pa.array[a] = p0.x;
      pa.array[a + 1] = p0.y;
      pa.array[a + 2] = p0.z;
      pa.array[b] = this.current.x;
      pa.array[b + 1] = this.current.y;
      pa.array[b + 2] = this.current.z;
      for (let c = 0; c < 3; c++) {
        oa.array[a + c] = srcOff.array[(i * TRAIL_RADIAL + k) * 3 + c];
        oa.array[b + c] = srcOff.array[(j * TRAIL_RADIAL + k) * 3 + c];
        ca.array[a + c] = srcCol.array[(i * TRAIL_RADIAL + k) * 3 + c];
        ca.array[b + c] = srcCol.array[(j * TRAIL_RADIAL + k) * 3 + c];
      }
    }
    pa.needsUpdate = true;
    oa.needsUpdate = true;
    ca.needsUpdate = true;
    this.aircraft.visible = true;
    this.aircraft.position.copy(this.current);
    const toRad = Math.PI / 180;
    this.aircraft.rotation.set(this.pose.pitch * toRad, this.pose.roll * toRad, -this.pose.pathHeading * toRad);
    const throttle = this.pose.thr === null ? 0 : (this.pose.thr + 1) / 2;
    const spinning = throttle > 0.08;
    if (spinning) this.propAngle += dt * (20 + PROP_MAX_RATE * throttle);
    this.prop.rotation.y = this.propAngle;
    this.disc.opacity = spinning ? 0.18 : 0;
    const groundZ = this.mapRef.groundAt(this.pose.lat, this.pose.lon, this.ground);
    const da = this.dropLine.geometry.getAttribute('position');
    da.array[0] = this.current.x;
    da.array[1] = this.current.y;
    da.array[2] = this.current.z;
    da.array[3] = this.current.x;
    da.array[4] = this.current.y;
    da.array[5] = groundZ;
    da.needsUpdate = true;
    this.dropLine.visible = true;
  }

  render(gl, args) {
    if (!this.log) return;
    const home = this.log.home;
    const mc = maplibregl.MercatorCoordinate.fromLngLat([home.lon, home.lat], 0);
    const s = mc.meterInMercatorCoordinateUnits();
    this.local.makeTranslation(mc.x, mc.y, mc.z).scale(new THREE.Vector3(s, s, s));
    const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
    this.camera.projectionMatrix.copy(m.multiply(this.local));
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    const lat = this.pose ? this.pose.lat : home.lat;
    const mpp = (METERS_PER_PIXEL_Z0 * Math.cos(lat * Math.PI / 180)) / 2 ** this.map.getZoom();
    const radius = Math.max(0.25, TRAIL_RADIUS_PX * mpp);
    this.ghostMaterial.uniforms.uRadius.value = radius;
    this.liveMaterial.uniforms.uRadius.value = radius;
    const scale = (AIRCRAFT_SPAN_PX * mpp) / SPAN;
    this.aircraft.scale.set(scale, scale, scale);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }
}

export class FlightMap {
  constructor(container, hooks) {
    this.hooks = hooks;
    this.log = null;
    this.mode = 'topdown';
    this.view = { bearing: 0, pitch: 0, zoom: 0 };
    this.cam = null;
    this.terrain = true;
    this.markers = [];
    this.baseZoom = 16;
    this.bearingFixed = 0;
    this.map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        sources: {
          imagery: {
            type: 'raster',
            tiles: [IMAGERY_URL],
            tileSize: 256,
            maxzoom: 19,
            attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics'
          },
          terrain: {
            type: 'raster-dem',
            tiles: [TERRAIN_URL],
            tileSize: 256,
            maxzoom: 15,
            encoding: 'terrarium',
            attribution: 'Terrain: Mapzen / AWS Open Data'
          }
        },
        layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }],
        sky: {
          'sky-color': '#7ab3e8',
          'horizon-color': '#d7e6f5',
          'fog-color': '#d7e6f5',
          'sky-horizon-blend': 0.6,
          'horizon-fog-blend': 0.6,
          'fog-ground-blend': 0.2
        }
      },
      center: [0, 20],
      zoom: 2,
      maxPitch: 85,
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true },
      centerClampedToGround: false
    });
    this.trail = new TrailLayer(this);
    this.ready = new Promise(resolve => {
      this.map.on('load', () => {
        this.map.setTerrain({ source: 'terrain', exaggeration: 1 });
        this.map.addLayer(this.trail);
        resolve();
      });
    });
    this.map.on('movestart', e => {
      if (e.originalEvent && this.hooks.onUserMove) this.hooks.onUserMove();
    });
    this.map.on('idle', () => this.syncGround());
    new ResizeObserver(() => this.map.resize()).observe(container);
  }

  groundAt(lat, lon, fallback) {
    if (!this.terrain) return 0;
    const e = this.map.queryTerrainElevation([lon, lat]);
    return e === null || e === undefined ? fallback : e;
  }

  syncGround() {
    if (!this.log) return;
    const g = this.groundAt(this.log.home.lat, this.log.home.lon, this.trail.ground);
    this.trail.setGround(g);
  }

  async setLog(log, path) {
    await this.ready;
    this.log = log;
    this.clearMarkers();
    const ground = this.groundAt(log.home.lat, log.home.lon, 0);
    this.trail.setLog(log, path, ground);
    this.addMarker(log.home.lat, log.home.lon, 'marker-home', 'Home');
    const fixes = log.samples.filter(s => s.gpsValid);
    const last = fixes[fixes.length - 1];
    this.addMarker(last.lat, last.lon, 'marker-end', 'Log end');
    const lats = fixes.map(s => s.lat);
    const lons = fixes.map(s => s.lon);
    const bounds = [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
    const cam = this.map.cameraForBounds(bounds, { padding: 80, maxZoom: 17 });
    this.baseZoom = cam ? clamp(cam.zoom - 0.4, 12, 17) : 16;
    this.cam = null;
    this.view = { bearing: 0, pitch: 0, zoom: 0 };
    this.map.jumpTo({ center: [log.home.lon, log.home.lat], zoom: this.baseZoom, pitch: this.terrain ? 55 : 0, bearing: 0, elevation: ground });
  }

  clear() {
    this.log = null;
    this.clearMarkers();
    this.trail.clear();
  }

  addMarker(lat, lon, className, title) {
    const el = document.createElement('div');
    el.className = `marker ${className}`;
    el.title = title;
    const m = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(this.map);
    this.markers.push(m);
  }

  clearMarkers() {
    for (const m of this.markers) m.remove();
    this.markers = [];
  }

  setColorMode(mode) {
    this.trail.setColorMode(mode);
  }

  setAltMode(mode) {
    this.trail.setAltMode(mode);
    this.cam = null;
  }

  setTerrainEnabled(on) {
    this.terrain = on;
    if (on) this.map.setTerrain({ source: 'terrain', exaggeration: 1 });
    else this.map.setTerrain(null);
    this.cam = null;
    if (this.log) this.trail.setGround(on ? this.groundAt(this.log.home.lat, this.log.home.lon, 0) : 0);
    if (!on) this.map.easeTo({ pitch: 0, duration: 400 });
  }

  setMode(mode) {
    this.mode = mode;
    this.view = { bearing: 0, pitch: 0, zoom: 0 };
    if (mode === 'manual') {
      this.cam = null;
      return;
    }
    const c = this.map.getCenter();
    this.bearingFixed = mode === 'topdown' ? this.map.getBearing() : 0;
    this.cam = {
      lon: c.lng,
      lat: c.lat,
      elevation: this.lastElevation === undefined ? this.trail.ground : this.lastElevation,
      bearing: this.map.getBearing(),
      pitch: this.map.getPitch(),
      zoom: this.map.getZoom()
    };
  }

  nudge(kind, amount) {
    if (this.mode === 'manual') {
      if (kind === 'bearing') this.map.easeTo({ bearing: this.map.getBearing() + amount, duration: 200 });
      if (kind === 'pitch') this.map.easeTo({ pitch: clamp(this.map.getPitch() + amount, 0, 85), duration: 200 });
      if (kind === 'zoom') this.map.easeTo({ zoom: this.map.getZoom() + amount, duration: 200 });
      return;
    }
    if (kind === 'bearing') this.view.bearing += amount;
    if (kind === 'pitch') this.view.pitch += amount;
    if (kind === 'zoom') this.view.zoom += amount;
  }

  resetNorth() {
    if (this.mode === 'manual') this.map.easeTo({ bearing: 0, duration: 300 });
    else this.view.bearing = -this.bearingFixed;
  }

  getBearing() {
    return this.map.getBearing();
  }

  target(now, state) {
    const z = this.baseZoom + this.view.zoom;
    const flat = !this.terrain;
    const pitchAdd = this.view.pitch;
    const head = state.pathHeading;
    switch (this.mode) {
      case 'chase':
        return { bearing: head + this.view.bearing, pitch: 68 + pitchAdd, zoom: z + 1.3 };
      case 'tail':
        return { bearing: head + this.view.bearing, pitch: 80 + pitchAdd, zoom: z + 2 };
      case 'orbit':
        return { bearing: (now / 1000) * 18 + this.view.bearing, pitch: 62 + pitchAdd, zoom: z + 1 };
      case 'cinematic':
        return {
          bearing: head + 110 + 50 * Math.sin(now / 7000) + this.view.bearing,
          pitch: 60 + 10 * Math.sin(now / 9000) + pitchAdd,
          zoom: z + 0.8 + 0.6 * Math.sin(now / 13000)
        };
      default:
        return { bearing: this.bearingFixed + this.view.bearing, pitch: flat ? 0 : 50 + pitchAdd, zoom: z };
    }
  }

  update(state, dt) {
    if (!this.log) return;
    this.trail.setPose(state, dt);
    if (this.mode === 'manual') return;
    const now = performance.now();
    const goal = this.target(now, state);
    const ground = this.groundAt(state.lat, state.lon, this.trail.ground);
    const elevation = this.terrain ? this.trail.zOf(state.alt) : ground;
    goal.pitch = clamp(goal.pitch, 0, 85);
    if (!this.cam) {
      this.cam = { lon: state.lon, lat: state.lat, elevation, ...goal };
    } else {
      const k = dt > 0 ? 1 - Math.exp(-dt * 5) : 1;
      this.cam.lon += (state.lon - this.cam.lon) * (dt > 0 ? 1 - Math.exp(-dt * 10) : 1);
      this.cam.lat += (state.lat - this.cam.lat) * (dt > 0 ? 1 - Math.exp(-dt * 10) : 1);
      this.cam.elevation += (elevation - this.cam.elevation) * k;
      this.cam.bearing = lerpAngle(this.cam.bearing, goal.bearing, k);
      this.cam.pitch += (goal.pitch - this.cam.pitch) * k;
      this.cam.zoom += (goal.zoom - this.cam.zoom) * k;
    }
    this.lastElevation = this.cam.elevation;
    this.map.jumpTo({
      center: [this.cam.lon, this.cam.lat],
      bearing: this.cam.bearing,
      pitch: this.cam.pitch,
      zoom: this.cam.zoom,
      elevation: this.cam.elevation
    });
  }
}

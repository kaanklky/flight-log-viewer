import * as THREE from 'three';

export const SPAN = 1.8;
const HALF = SPAN / 2;
const WING_ROOT_LE = 0.13;
const WING_ROOT_CHORD = 0.2;
const STATIONS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.88, 0.93, 0.96, 0.98, 0.992, 1];

function loft(rings) {
  const m = rings[0].length;
  const pos = [];
  for (const ring of rings) for (const p of ring) pos.push(p[0], p[1], p[2]);
  const index = [];
  for (let r = 0; r < rings.length - 1; r++) {
    for (let k = 0; k < m; k++) {
      const a = r * m + k;
      const b = r * m + ((k + 1) % m);
      const c = (r + 1) * m + k;
      const d = (r + 1) * m + ((k + 1) % m);
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function strip(rows) {
  const pos = [];
  for (const [a, b] of rows) pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  const index = [];
  for (let r = 0; r < rows.length - 1; r++) {
    const a = r * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function wingChord(a) {
  if (a <= 0.5) return WING_ROOT_CHORD;
  if (a <= 0.95) return WING_ROOT_CHORD - (WING_ROOT_CHORD - 0.08) * ((a - 0.5) / 0.45) ** 1.3;
  return 0.08 * Math.sqrt(Math.max(0, 1 - ((a - 0.95) / 0.05) ** 2)) + 0.004;
}

function wingStations() {
  const list = [];
  for (let i = STATIONS.length - 1; i > 0; i--) list.push(-STATIONS[i]);
  for (const s of STATIONS) list.push(s);
  return list;
}

function wingSection(a) {
  const A = Math.abs(a);
  const c = wingChord(A);
  const x = HALF * a;
  const le = WING_ROOT_LE - 0.03 * A * A;
  const z = 0.015 + 0.075 * A ** 2.2;
  const t = 0.012 * (c / WING_ROOT_CHORD) + 0.001;
  return { x, le, c, z, t };
}

function buildWing() {
  const rings = [];
  const stripes = [];
  const greyStripes = [];
  for (const a of wingStations()) {
    const w = wingSection(a);
    rings.push([
      [w.x, w.le, w.z],
      [w.x, w.le - 0.35 * w.c, w.z + w.t],
      [w.x, w.le - w.c, w.z],
      [w.x, w.le - 0.35 * w.c, w.z - w.t * 0.6]
    ]);
    if (Math.abs(a) > 0.08 && Math.abs(a) < 0.9) {
      stripes.push([
        [w.x, w.le - 0.255 * w.c, w.z + w.t * 0.73 + 0.0015],
        [w.x, w.le - 0.345 * w.c, w.z + w.t * 0.986 + 0.0015]
      ]);
      greyStripes.push([
        [w.x, w.le - 0.55 * w.c, w.z + w.t * 0.8 + 0.0012],
        [w.x, w.le - 0.62 * w.c, w.z + w.t * 0.62 + 0.0012]
      ]);
    }
  }
  const leftCut = stripes.findIndex(r => r[0][0] > 0);
  return {
    wing: loft(rings),
    red: [strip(stripes.slice(0, leftCut)), strip(stripes.slice(leftCut))],
    grey: [strip(greyStripes.slice(0, leftCut)), strip(greyStripes.slice(leftCut))]
  };
}

function buildStabilizer() {
  const rings = [];
  const half = 0.19;
  const stations = [];
  for (let i = STATIONS.length - 1; i > 0; i--) stations.push(-STATIONS[i]);
  for (const s of STATIONS) stations.push(s);
  for (const a of stations) {
    const A = Math.abs(a);
    const c = A < 0.9 ? 0.1 - 0.03 * A : 0.07 * Math.sqrt(Math.max(0, 1 - ((A - 0.9) / 0.1) ** 2)) + 0.003;
    const x = half * a;
    const le = -0.58;
    rings.push([
      [x, le, 0.03],
      [x, le - 0.35 * c, 0.036],
      [x, le - c, 0.03],
      [x, le - 0.35 * c, 0.026]
    ]);
  }
  return loft(rings);
}

function buildFin() {
  return loft([
    [[-0.005, -0.52, 0.01], [0.005, -0.52, 0.01], [0.005, -0.7, 0.01], [-0.005, -0.7, 0.01]],
    [[-0.004, -0.645, 0.2], [0.004, -0.645, 0.2], [0.004, -0.715, 0.2], [-0.004, -0.715, 0.2]]
  ]);
}

function buildFuselage() {
  const profile = [
    [0, 0.345],
    [0.012, 0.335],
    [0.022, 0.31],
    [0.034, 0.25],
    [0.04, 0.17],
    [0.04, 0.06],
    [0.034, -0.05],
    [0.024, -0.2],
    [0.016, -0.36],
    [0.012, -0.5],
    [0.01, -0.66],
    [0.008, -0.7],
    [0, -0.7]
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(profile, 20);
  g.scale(1, 1, 1.15);
  return g;
}

export function buildEasyGlider() {
  const group = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f2ef, side: THREE.DoubleSide });
  const overlay = { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 };
  const red = new THREE.MeshLambertMaterial({ color: 0xc9232d, ...overlay });
  const grey = new THREE.MeshLambertMaterial({ color: 0x4a4e54, ...overlay });
  const dark = new THREE.MeshLambertMaterial({ color: 0x25262a, side: THREE.DoubleSide });
  const { wing, red: redStripes, grey: greyStripes } = buildWing();
  group.add(new THREE.Mesh(wing, white));
  for (const g of redStripes) group.add(new THREE.Mesh(g, red));
  for (const g of greyStripes) group.add(new THREE.Mesh(g, grey));
  group.add(new THREE.Mesh(buildFuselage(), white));
  group.add(new THREE.Mesh(buildStabilizer(), white));
  group.add(new THREE.Mesh(buildFin(), white));
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), dark);
  canopy.scale.set(0.034, 0.1, 0.026);
  canopy.position.set(0, 0.15, 0.03);
  group.add(canopy);
  const finStripe = new THREE.Mesh(
    strip([
      [[-0.0052, -0.6, 0.06], [-0.0052, -0.66, 0.06]],
      [[-0.0048, -0.63, 0.13], [-0.0048, -0.67, 0.13]]
    ]),
    red
  );
  group.add(finStripe);
  const finStripeRight = finStripe.clone();
  finStripeRight.scale.x = -1;
  group.add(finStripeRight);
  const prop = new THREE.Group();
  prop.position.set(0, 0.34, 0.0);
  const blades = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.003, 0.02), grey);
  prop.add(blades);
  const discMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.15, 28), discMat);
  disc.rotation.x = -Math.PI / 2;
  group.add(disc);
  disc.position.set(0, 0.34, 0);
  group.add(prop);
  group.traverse(o => {
    o.frustumCulled = false;
  });
  return { group, prop, discMat };
}

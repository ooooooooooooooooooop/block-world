const estimatedProfile = Object.freeze({
  width: 6.4,
  length: 14,
  depth: 3.6,
  approach: 2.4,
  topRise: 0.48,
  landingLength: 2.5,
  plinthSteps: 3,
  stairSteps: 32,
  boundaryBand: 0.7,
  dimensionsEstimated: true,
  source: '2025 entrance photographs; profile dimensions are visual estimates'
});

const records = [
  {
    id: '1',
    gcj02: [112.975158, 28.195143],
    wgs84: [112.96962481115216, 28.19858269316214],
    x: -2976.665,
    z: 157.598,
    dx: 1,
    dz: 0,
    source: 'https://ditu.amap.com/place/BT09909685',
    sourceKind: 'provider named POI, not surveyed',
    positionAccuracyProven: false,
    orientationBasis: 'road-aligned estimate using 2025 photographic context; not measured bearing',
    sourcePhoto: 'artifacts/wuyi-entrances-20261015/references/1-recent.png'
  },
  {
    id: '2',
    gcj02: [112.976086, 28.195045],
    wgs84: [112.97054974518376, 28.198482219294412],
    x: -2886.025,
    z: 168.77,
    dx: Math.SQRT1_2,
    dz: Math.SQRT1_2,
    source: 'https://ditu.amap.com/place/BX09909651',
    sourceKind: 'provider named POI, not surveyed',
    positionAccuracyProven: false,
    orientationBasis: '2025 renovation report documents northwest-facing mouth; exact bearing is approximated as 315 degrees',
    orientationSource: 'https://news.cjn.cn/zjzycsqpd/jtys/202505/t5136437.htm',
    sourcePhoto: 'artifacts/wuyi-polish-20261015/exit-references/2.png'
  },
  {
    id: '4',
    gcj02: [112.976627, 28.194954],
    wgs84: [112.97108895015909, 28.19838976687646],
    x: -2833.185,
    z: 179.05,
    dx: 0,
    dz: 1,
    source: 'https://ditu.amap.com/place/BT09909666',
    sourceKind: 'provider named POI, not surveyed',
    positionAccuracyProven: false,
    orientationBasis: 'road-aligned estimate using 2025 photographic context; not measured bearing',
    sourcePhoto: 'artifacts/wuyi-polish-20261015/exit-references/4.png'
  },
  {
    id: '8',
    gcj02: [112.975179, 28.195555],
    wgs84: [112.96964570899505, 28.19899464906183],
    x: -2974.618,
    z: 111.79,
    dx: 1,
    dz: 0,
    source: 'https://ditu.amap.com/place/BT09909673',
    sourceKind: 'provider named POI, not surveyed',
    positionAccuracyProven: false,
    orientationBasis: 'road-aligned estimate using 2025 photographic context; not measured bearing',
    sourcePhoto: 'artifacts/wuyi-polish-20261015/exit-references/8.png'
  },
  {
    id:'5',x:-2685,z:168.8,dx:-1,dz:0,
    source:'https://commons.wikimedia.org/wiki/File:Entrance_No._5_of_Wuyi_Square_Station,_Picture1_20250802.jpg',
    sourceKind:'photo-context reconstructed anchor, not a named provider or surveyed door',
    sourcePhoto:'artifacts/wuyi-polish-20261015/exit-references/5.png',
    photographerWgs84:[112.9726833,28.1984472],
    positionAccuracyProven:false,orientationBasis:'west-facing mouth inferred from New World/road context in the 2025-08-02 photo; photographer GPS is not used as door position',
    profile:Object.freeze({...estimatedProfile,width:8.4,length:16,topRise:.72,plinthSteps:6})
  },
  {
    id:'7',x:-2876.8,z:96,dx:0,dz:1,
    source:'https://commons.wikimedia.org/wiki/File:Entrance_No._7_of_Wuyi_Square_Station_20250802.jpg',
    sourceKind:'photo-context reconstructed anchor, not a named provider or surveyed door',
    sourcePhoto:'artifacts/wuyi-polish-20261015/exit-references/7.png',
    photographerWgs84:[112.9706389,28.1992306],
    positionAccuracyProven:false,orientationBasis:'south-facing mouth inferred from Heiwado left/7mall right in the 2025-08-02 photo; photographer GPS is not used as door position',
    profile:Object.freeze({...estimatedProfile,width:5.4,length:14,topRise:.72,plinthSteps:5})
  }

];

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const SURFACE_METRO_EXIT_PROFILE = estimatedProfile;

export const SURFACE_METRO_EXITS = Object.freeze(records.map((record) => deepFreeze({
  ...record,
  gcj02: record.gcj02?[...record.gcj02]:null,
  wgs84: record.wgs84?[...record.wgs84]:null,
  sourceBuildingAtPoint: [],
  photoYear: 2025,
  orientationEstimated: true,
  dimensionsEstimated: true,
  surveyed: false,
  profile: record.profile??SURFACE_METRO_EXIT_PROFILE
})));

function localCoordinates(exit, x, z) {
  const dx = x - exit.x;
  const dz = z - exit.z;
  return {
    along: dx * exit.dx + dz * exit.dz,
    lateral: -dx * exit.dz + dz * exit.dx
  };
}

function within(exit, x, z, margin) {
  const { along, lateral } = localCoordinates(exit, x, z);
  const profile = exit.profile;
  return along >= -profile.approach - margin &&
    along <= profile.length + margin &&
    Math.abs(lateral) <= profile.width / 2 + margin;
}

/**
 * Returns the named exit and local profile coordinates when a point falls
 * inside its oriented XZ rectangle. Positive along follows the estimated
 * entrance orientation; positive lateral is the left-hand side.
 */
export function surfaceExitAt(x, z, margin = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const safeMargin = Number.isFinite(margin) ? Math.max(0, margin) : 0;
  for (const exit of SURFACE_METRO_EXITS) {
    if (!within(exit, x, z, safeMargin)) continue;
    return { exit, ...localCoordinates(exit, x, z) };
  }
  return null;
}

/**
 * Walkable elevation relative to local surrounding grade. Treads are
 * piecewise level so the rendered steps and movement sampler share a profile.
 */
export function surfaceExitOffset(x, z) {
  const match = surfaceExitAt(x, z);
  if (!match) return null;
  const { profile } = match.exit;
  const { along } = match;
  if (along < 0) {
    const treadRun = profile.approach / profile.plinthSteps;
    const step = Math.min(profile.plinthSteps - 1,
      Math.floor((along + profile.approach) / treadRun));
    return profile.topRise * (step + 1) / profile.plinthSteps;
  }
  if (along <= profile.landingLength) return profile.topRise;
  const stairRun = profile.length - profile.landingLength;
  const treadRun = stairRun / profile.stairSteps;
  const step = Math.min(profile.stairSteps - 1,
    Math.floor((along - profile.landingLength) / treadRun));
  return profile.topRise -
    (profile.topRise + profile.depth) * (step + 1) / profile.stairSteps;
}

/**
 * XZ rectangles for terrain clipping. Each includes the approach steps and
 * carries source/estimate metadata so consumers do not imply survey accuracy.
 */
export function surfaceExitPolygons() {
  return SURFACE_METRO_EXITS.map((exit) => {
    const { profile } = exit;
    const corners = [
      [-profile.approach, -profile.width / 2],
      [profile.length, -profile.width / 2],
      [profile.length, profile.width / 2],
      [-profile.approach, profile.width / 2]
    ];
    const points = corners.map(([along, lateral]) => [
      exit.x + exit.dx * along - exit.dz * lateral,
      exit.z + exit.dz * along + exit.dx * lateral
    ]);
    const xs = points.map(([x]) => x);
    const zs = points.map(([, z]) => z);
    return {
      id: exit.id,
      points,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
      source: exit.source,
      sourcePhoto: exit.sourcePhoto,
      surveyed: false,
      dimensionsEstimated: true,
      orientationEstimated: true
    };
  });
}

/**
 * Collision predicate for the parent movement layer. referenceOffset is the
 * actor's current feet height relative to local terrain. Only below-grade
 * candidates in the 0.7 m side/back wall band block; the entrance front stays
 * open and grade-level ledge safety remains the parent's responsibility.
 */
export function surfaceExitBoundary(x, z, referenceOffset) {
  if (!Number.isFinite(x) || !Number.isFinite(z) ||
      !Number.isFinite(referenceOffset) || referenceOffset >= -0.72) return false;
  for (const exit of SURFACE_METRO_EXITS) {
    const { along, lateral } = localCoordinates(exit, x, z);
    const { profile } = exit;
    const inside = along >= -profile.approach &&
      along <= profile.length &&
      Math.abs(lateral) <= profile.width / 2;
    if (inside) return false;
    const withinBand = along >= -profile.approach &&
      along <= profile.length + profile.boundaryBand &&
      Math.abs(lateral) <= profile.width / 2 + profile.boundaryBand;
    if (withinBand && along >= 0) return true;
  }
  return false;
}

// Travel progress is shared by the HUD, journal, field guide and local save.
// Only completed world interactions and successful photo transactions enter it.
const records = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const finiteDistance = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

export function createJourney({ pois = [], saved, legacyVisited = [], distance = 0 } = {}) {
  const restored = records(saved);
  const state = {
    schemaVersion: 2,
    trackedTarget: typeof restored.trackedTarget === 'string' ? restored.trackedTarget : null,
    discoveries: { ...records(restored.discoveries) },
    photos: { ...records(restored.photos) },
    subjects: { ...records(restored.subjects) },
    encounters: { ...records(restored.encounters) },
    distance: Math.max(finiteDistance(distance), finiteDistance(restored.distance)),
  };
  for (const id of legacyVisited) {
    const poi = pois.find((p) => p.id === id);
    if (poi && !state.discoveries[id]) state.discoveries[id] = { id, name: poi.name, kind: 'place', restored: true };
  }
  function discover(poi, at = new Date().toISOString()) {
    if (!poi?.id || state.discoveries[poi.id]) return false;
    state.discoveries[poi.id] = { id: poi.id, name: poi.name, kind: 'place', at };
    return true;
  }
  function savedPhoto(meta) {
    if (!meta?.id || state.photos[meta.id]) return false;
    // A location caption never unlocks a building. Retain the ray-tested result.
    const capturedAt = meta.createdAt || new Date().toISOString();
    const subjects = Array.isArray(meta.visibleSubjects) ? meta.visibleSubjects.filter((s) => s.osmId && s.name && s.visibleSamples > 0) : [];
    state.photos[meta.id] = { id: meta.id, place: meta.place || '长沙街头', at: capturedAt, subjectKeys: subjects.map((s) => 'osm:' + s.osmId), people: (meta.visiblePeople || []).filter(p => p.id && p.visibleSamples >= 2).map(p => ({id:p.id,name:p.name})) };
    for (const subject of subjects) {
      const key = 'osm:' + subject.osmId;
      if (!state.subjects[key]) state.subjects[key] = { key, name: subject.name, firstPhotoId: meta.id, at: capturedAt, method: 'visible-ray-samples' };
    }
    return true;
  }
  function talk(result, at = new Date().toISOString()) {
    if (!result?.found || !result.npcId || state.encounters[result.npcId]) return false;
    state.encounters[result.npcId] = { id: result.npcId, name: result.name, place: result.place || '长沙街头', message: result.message || '', at };
    return true;
  }
  function observeDistance(value) { state.distance = Math.max(state.distance, finiteDistance(value)); }
  function goals() {
    const photoCount = Object.keys(state.photos).length, chatCount = Object.keys(state.encounters).length;
    return [
      { id: 'first-photo', title: '留下第一张长沙', detail: '用相机取景，把照片存入相册。', done: photoCount > 0, progress: Math.min(1, photoCount), target: 1, stamp: '城市初见' },
      { id: 'first-chat', title: '听听街角的长沙', detail: '靠近一位路人，按 E 打个招呼。', done: chatCount > 0, progress: Math.min(1, chatCount), target: 1, stamp: '街角相遇' },
      { id: 'first-walk', title: '沿街走一段', detail: '沿着街道走过 100 米。', done: state.distance >= 100, progress: Math.min(100, Math.floor(state.distance)), target: 100, stamp: '步履长沙' },
    ];
  }
  return { discover, savedPhoto, talk, observeDistance, goals, track(id) { state.trackedTarget = typeof id === 'string' ? id : null; }, snapshot: () => structuredClone(state) };
}

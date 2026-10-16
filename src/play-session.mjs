// Owns player input context; no Three.js objects or browser state in this model.
export function createPlaySession() {
  let mode = 'welcome', panel = null;
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(snapshot()); };
  const snapshot = () => ({ mode, panel, started: mode !== 'welcome',
    movement: mode === 'explore' && !panel, look: mode !== 'welcome' && !panel });
  return {
    get started() { return mode !== 'welcome'; },
    get photography() { return mode === 'photo'; },
    get panel() { return panel; },
    snapshot,
    start() { mode = 'explore'; panel = null; emit(); },
    enterPhoto() { if (mode === 'welcome') return false; mode = 'photo'; panel = null; emit(); return true; },
    exitPhoto() { if (mode !== 'photo') return false; mode = 'explore'; panel = null; emit(); return true; },
    open(id) { if (mode === 'welcome') return false; panel = id; emit(); return true; },
    close() { panel = null; emit(); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

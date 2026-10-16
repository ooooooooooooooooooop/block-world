// Physical input is mapped once. Menus and photo mode cannot retain walking keys.
export const ACTION_KEYS = Object.freeze({ Escape:'back', KeyM:'map', KeyC:'camera',
  KeyP:'album', KeyB:'journey', KeyN:'guide', KeyJ:'tasks', KeyH:'help',
  KeyV:'view', KeyF:'shutter', KeyE:'interact' });
const MOVEMENT = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown',
  'ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight']);
export function bindGameInput({ canvas, getContext, onAction, onManualMove, onLockError }) {
  const win = canvas.ownerDocument.defaultView, doc = canvas.ownerDocument;
  const keys = new Set(), removers = [];
  let drag = false, travel = 0, lastX = 0, lastY = 0, yaw = 0, pitch = 0;
  function listen(target, type, fn, options) { target.addEventListener(type, fn, options);
    removers.push(() => target.removeEventListener(type, fn, options)); }
  function clear() { keys.clear(); drag = false; yaw = pitch = 0; canvas.style.cursor = ''; }
  function typing(target) { return target?.isContentEditable ||
    target?.tagName==='TEXTAREA' || (target?.tagName==='INPUT' && !['range','checkbox','button'].includes(target.type)); }
  listen(win, 'keydown', e => {
    const action = ACTION_KEYS[e.code];
    if (action === 'back') { e.preventDefault(); clear(); onAction(action); return; }
    if (typing(doc.activeElement)) return;
    const context = getContext();
    if (!context.started) return;
    if (action) { if (e.repeat) return; e.preventDefault(); onAction(action); return; }
    if (MOVEMENT.has(e.code) && context.movement) {
      e.preventDefault(); keys.add(e.code); onManualMove?.();
    }
  });
  listen(win, 'keyup', e => keys.delete(e.code));
  listen(canvas, 'mousedown', e => {
    if (!getContext().look || ![0,2].includes(e.button)) return;
    if (e.button === 2 && doc.pointerLockElement) doc.exitPointerLock();
    drag = true; travel = 0; lastX = e.clientX; lastY = e.clientY;
    canvas.focus({preventScroll:true}); canvas.style.cursor = 'grabbing';
  });
  listen(canvas, 'contextmenu', e => e.preventDefault());
  listen(win, 'mouseup', () => { drag = false; canvas.style.cursor = ''; });
  listen(win, 'mousemove', e => {
    if (!getContext().look) return;
    if (doc.pointerLockElement === canvas) {
      yaw += (Number(e.movementX)||0)*.0026; pitch -= (Number(e.movementY)||0)*.002;
    } else if (drag) {
      const dx = e.clientX-lastX, dy = e.clientY-lastY; travel += Math.hypot(dx,dy);
      yaw += dx*.0026; pitch -= dy*.002;
    }
    lastX = e.clientX; lastY = e.clientY;
  });
  listen(canvas, 'click', async () => {
    const context = getContext();
    if (!context.movement || travel > 4 || doc.hidden) return;
    try { await canvas.requestPointerLock?.(); } catch { onLockError?.(); }
  });
  listen(doc, 'pointerlockchange', () => { if (!doc.pointerLockElement) clear(); });
  listen(win, 'blur', clear);
  listen(doc, 'visibilitychange', () => { if (doc.hidden) clear(); });
  function sample() {
    const context = getContext();
    const result = {
      forward: context.movement ? Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown')) : 0,
      right: context.movement ? Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft')) : 0,
      run: context.movement && (keys.has('ShiftLeft')||keys.has('ShiftRight')),
      jump: context.movement && keys.has('Space'),
      yawDelta: context.look ? yaw : 0, pitchDelta: context.look ? pitch : 0,
    };
    yaw = pitch = 0; return result;
  }
  return { clear, sample, dispose() { clear(); for (const remove of removers) remove(); } };
}

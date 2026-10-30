/*
 * state.js — Central reactive state store.
 * HOW TO CHANGE:
 *   • Add a new state key: add it to `state` object below with a default.
 *   • Any module can import { state, subscribe, setState } and react to changes.
 *   • subscribe(listener) — listener(state, changedKeys) called on every setState.
 *   • setState({ key: value }) — merges keys, notifies all subscribers.
 *   • To add a derived value, compute it inside a subscriber.
 */

const state = {
  selectedId: null,      // currently focused body id
  compareA: null,        // compare drawer body A
  compareB: null,        // compare drawer body B
  compareOpen: false,    // compare drawer visible
  paused: false,         // simulation paused
  speed: 1,             // simulation speed multiplier
  filter: 'All',        // active filter chip
  query: '',            // search text
  showOrbits: true,     // orbit line visibility
  showLabels: true,     // CSS2D label visibility
  showTrails: true,     // planet trail visibility
  showAsteroids: true,  // asteroid belt visibility
  qualityHigh: true,    // high / low quality toggle
  tourActive: false,    // auto-tour running
  elapsedDays: 0,       // simulated elapsed days
  introComplete: false, // intro animation done
  compareChart: 'bar'   // 'bar' or 'radar'
};

const listeners = new Set();

/** Subscribe to state changes. Returns unsubscribe function. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Get current state (read-only snapshot). */
export function getState() {
  return state;
}

/** Merge partial state and notify subscribers. */
export function setState(partial) {
  const changed = [];
  for (const key in partial) {
    if (state[key] !== partial[key]) {
      state[key] = partial[key];
      changed.push(key);
    }
  }
  if (changed.length > 0) {
    for (const fn of listeners) {
      try { fn(state, changed); } catch (e) { console.error('State subscriber error:', e); }
    }
  }
}

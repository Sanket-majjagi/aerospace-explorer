/*
 * ui.js — All HUD UI: panels, search, filters, info panel, controls, keyboard.
 * HOW TO CHANGE:
 *   • Add a toggle: add a button in buildControlDock(), wire to state key.
 *   • Change speed range: edit SPEED_MIN / SPEED_MAX.
 *   • Add info field: add to renderInfoPanel() fields array.
 *   • Change theme: all colors via CSS variables in style.css :root.
 */

import { BODIES, BODY_MAP, EARTH, FILTER_TYPES, TOUR_SEQUENCE } from './data.js';
import { getState, setState, subscribe } from './state.js';
import { flyToOverview, flyToBody, getBodyWorldPos } from './scene.js';

const SPEED_MIN = 0.1;
const SPEED_MAX = 50;
let tourTimer = null;
let tourIndex = 0;
let countUpAnimations = {};

/* ── Public ──────────────────────────────────────────── */
export function initUI() {
  buildSearch();
  buildFilterChips();
  buildBodyList();
  buildInfoPanel();
  buildControlDock();
  setupKeyboard();
  subscribeUI();
}

/* ── Search ──────────────────────────────────────────── */
function buildSearch() {
  const input = document.getElementById('search-input');
  const dropdown = document.getElementById('search-dropdown');

  input.addEventListener('input', () => {
    setState({ query: input.value });
  });

  input.addEventListener('focus', () => {
    dropdown.classList.add('visible');
    renderSearchDropdown();
  });

  input.addEventListener('blur', () => {
    setTimeout(() => dropdown.classList.remove('visible'), 200);
  });

  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.search-item');
    let idx = Array.from(items).findIndex(i => i.classList.contains('active'));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      idx = Math.min(idx + 1, items.length - 1);
      items.forEach((it, i) => it.classList.toggle('active', i === idx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      idx = Math.max(idx - 1, 0);
      items.forEach((it, i) => it.classList.toggle('active', i === idx));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (idx >= 0 && items[idx]) {
        const id = items[idx].dataset.id;
        setState({ selectedId: id, compareA: id, query: '' });
        input.value = '';
        input.blur();
      }
    }
  });
}

function renderSearchDropdown() {
  const dropdown = document.getElementById('search-dropdown');
  const st = getState();
  const q = st.query.toLowerCase();
  const filtered = BODIES.filter(b => {
    if (q && !b.name.toLowerCase().includes(q)) return false;
    if (st.filter !== 'All' && b.type !== st.filter) return false;
    return true;
  });
  dropdown.innerHTML = filtered.map((b, i) =>
    `<div class="search-item ${i === 0 ? 'active' : ''}" data-id="${b.id}">
      <span class="search-dot" style="background:${b.colorPrimary}"></span>
      ${b.name} <span class="search-type">${b.type}</span>
    </div>`
  ).join('');
  dropdown.querySelectorAll('.search-item').forEach(el => {
    el.addEventListener('mousedown', () => {
      const id = el.dataset.id;
      setState({ selectedId: id, compareA: id, query: '' });
      document.getElementById('search-input').value = '';
    });
  });
}

/* ── Filter Chips ────────────────────────────────────── */
function buildFilterChips() {
  const container = document.getElementById('filter-chips');
  container.innerHTML = FILTER_TYPES.map(t =>
    `<button class="chip ${t === 'All' ? 'active' : ''}" data-filter="${t}">${t}</button>`
  ).join('');
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    setState({ filter: btn.dataset.filter });
  });
}

/* ── Body List ───────────────────────────────────────── */
function buildBodyList() {
  renderBodyList();
}

function renderBodyList() {
  const list = document.getElementById('body-list');
  const st = getState();
  const q = st.query.toLowerCase();
  const filtered = BODIES.filter(b => {
    if (q && !b.name.toLowerCase().includes(q)) return false;
    if (st.filter !== 'All' && b.type !== st.filter) return false;
    return true;
  });
  list.innerHTML = filtered.map(b => {
    const isSelected = st.selectedId === b.id;
    const distLabel = b.au > 0 ? `${b.au} AU` : (b.id === 'sun' ? 'Center' : '');
    return `<div class="body-item ${isSelected ? 'selected' : ''}" data-id="${b.id}">
      <span class="body-dot" style="background:${b.colorPrimary};box-shadow:0 0 6px ${b.colorPrimary}"></span>
      <div class="body-item-info">
        <span class="body-item-name">${b.name}</span>
        <span class="body-item-dist">${distLabel}</span>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.body-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      setState({ selectedId: id, compareA: id });
    });
  });
}

/* ── Info Panel ──────────────────────────────────────── */
function buildInfoPanel() {
  // Panel is in HTML, populated dynamically
}

function renderInfoPanel() {
  const panel = document.getElementById('info-panel');
  const st = getState();
  if (!st.selectedId) {
    panel.classList.remove('visible');
    return;
  }
  const data = BODY_MAP[st.selectedId];
  if (!data) return;
  panel.classList.add('visible');

  const diameterEarth = EARTH.diameterKm > 0 ? (data.diameterKm / EARTH.diameterKm) : 0;
  const rotPeriod = Math.abs(data.rotationHours);
  const rotLabel = rotPeriod > 48 ? `${(rotPeriod / 24).toFixed(1)} days` : `${rotPeriod.toFixed(1)} hours`;
  const retrograde = data.rotationHours < 0 ? ' (retrograde)' : '';
  const orbDays = data.orbitalPeriodDays;
  const orbYears = orbDays > 0 ? (orbDays / 365.25).toFixed(2) : '—';
  const gravStr = data.gravityMs2 === Infinity ? '∞' : `${data.gravityMs2} m/s²`;

  const fields = [
    { label: 'Type', value: data.type, badge: true },
    { label: 'Diameter', value: `${data.diameterKm.toLocaleString()} km`, sub: `${diameterEarth.toFixed(2)}× Earth` },
    { label: 'Distance from Sun', value: `${data.distanceMKm.toLocaleString()} M km`, sub: `${data.au} AU` },
    { label: 'Orbital Period', value: `${orbDays.toLocaleString()} days`, sub: `${orbYears} years` },
    { label: 'Rotation Period', value: rotLabel + retrograde },
    { label: 'Mass', value: data.massKg },
    { label: 'Surface Gravity', value: gravStr },
    { label: 'Avg Temperature', value: `${data.tempC}°C` },
    { label: 'Known Moons', value: data.moons.toString() }
  ];

  const sizeBarWidth = Math.min(diameterEarth * 100, 100);

  panel.innerHTML = `
    <div class="info-header">
      <h2 class="info-name">${data.name}</h2>
      <span class="info-badge" style="background:${data.colorPrimary}40;color:${data.colorPrimary}">${data.type}</span>
      <button class="info-close" id="info-close">✕</button>
    </div>
    <div class="info-fields">
      ${fields.map(f => `
        <div class="info-field">
          <span class="info-label">${f.label}</span>
          <span class="info-value" data-target="${f.value}">${f.value}</span>
          ${f.sub ? `<span class="info-sub">${f.sub}</span>` : ''}
        </div>
      `).join('')}
    </div>
    <div class="info-size-bar">
      <span class="info-label">Size vs Earth</span>
      <div class="size-bar-track">
        <div class="size-bar-fill" style="width:${sizeBarWidth}%;background:${data.colorPrimary}"></div>
      </div>
      <span class="size-bar-label">${diameterEarth.toFixed(2)}×</span>
    </div>
    <div class="info-fact">
      <span class="fact-icon">💡</span> ${data.funFact}
    </div>
    <button class="btn btn-compare" id="btn-compare-from-info">Compare</button>
  `;

  document.getElementById('info-close').addEventListener('click', () => {
    setState({ selectedId: null });
    flyToOverview();
  });

  document.getElementById('btn-compare-from-info').addEventListener('click', () => {
    setState({ compareOpen: true, compareA: st.selectedId });
  });

  // Animate numbers
  animateCountUp(panel);
}

function animateCountUp(panel) {
  const els = panel.querySelectorAll('.info-value');
  els.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.4s, transform 0.4s';
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });
  });
}

/* ── Control Dock ────────────────────────────────────── */
function buildControlDock() {
  const dock = document.getElementById('control-dock');
  const st = getState();
  dock.innerHTML = `
    <button class="dock-btn" id="btn-pause" title="Play/Pause (Space)">
      <span class="dock-icon">${st.paused ? '▶' : '⏸'}</span>
      <span class="dock-label">${st.paused ? 'Play' : 'Pause'}</span>
    </button>
    <div class="dock-slider-group">
      <label class="dock-label">Speed</label>
      <input type="range" id="speed-slider" min="${SPEED_MIN}" max="${SPEED_MAX}" step="0.1" value="${st.speed}">
      <span class="dock-readout" id="speed-readout">${st.speed.toFixed(1)}x</span>
    </div>
    <div class="dock-time" id="elapsed-time" title="Simulated elapsed time">
      Day 0
    </div>
    <button class="dock-btn" id="btn-reset" title="Reset View (R)">
      <span class="dock-icon">🏠</span>
      <span class="dock-label">Reset</span>
    </button>
    <button class="dock-btn" id="btn-tour" title="Auto Tour (T)">
      <span class="dock-icon">🚀</span>
      <span class="dock-label">Tour</span>
    </button>
    <button class="dock-btn" id="btn-compare" title="Compare (C)">
      <span class="dock-icon">⚖️</span>
      <span class="dock-label">Compare</span>
    </button>
    <div class="dock-toggles">
      <label class="toggle-label"><input type="checkbox" id="tog-orbits" ${st.showOrbits ? 'checked' : ''}> Orbits</label>
      <label class="toggle-label"><input type="checkbox" id="tog-labels" ${st.showLabels ? 'checked' : ''}> Labels</label>
      <label class="toggle-label"><input type="checkbox" id="tog-trails" ${st.showTrails ? 'checked' : ''}> Trails</label>
      <label class="toggle-label"><input type="checkbox" id="tog-asteroids" ${st.showAsteroids ? 'checked' : ''}> Asteroids</label>
    </div>
    <div class="dock-quality">
      <button class="dock-btn small ${st.qualityHigh ? 'active' : ''}" id="btn-quality-high">High</button>
      <button class="dock-btn small ${!st.qualityHigh ? 'active' : ''}" id="btn-quality-low">Low</button>
    </div>
  `;

  // Event listeners
  document.getElementById('btn-pause').addEventListener('click', () => {
    setState({ paused: !getState().paused });
  });

  document.getElementById('speed-slider').addEventListener('input', (e) => {
    setState({ speed: parseFloat(e.target.value) });
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    setState({ selectedId: null, tourActive: false });
    stopTour();
    flyToOverview();
  });

  document.getElementById('btn-tour').addEventListener('click', () => {
    if (getState().tourActive) {
      stopTour();
    } else {
      startTour();
    }
  });

  document.getElementById('btn-compare').addEventListener('click', () => {
    const st = getState();
    setState({ compareOpen: !st.compareOpen });
  });

  ['orbits', 'labels', 'trails', 'asteroids'].forEach(key => {
    const stateKey = 'show' + key.charAt(0).toUpperCase() + key.slice(1);
    document.getElementById(`tog-${key}`).addEventListener('change', (e) => {
      setState({ [stateKey]: e.target.checked });
    });
  });

  document.getElementById('btn-quality-high').addEventListener('click', () => {
    setState({ qualityHigh: true });
  });
  document.getElementById('btn-quality-low').addEventListener('click', () => {
    setState({ qualityHigh: false });
  });
}

/* ── Tour ────────────────────────────────────────────── */
function startTour() {
  tourIndex = 0;
  setState({ tourActive: true });
  advanceTour();
}

function stopTour() {
  setState({ tourActive: false });
  if (tourTimer) clearTimeout(tourTimer);
  tourTimer = null;
  const caption = document.getElementById('tour-caption');
  if (caption) caption.classList.remove('visible');
}

function advanceTour() {
  if (!getState().tourActive) return;
  if (tourIndex >= TOUR_SEQUENCE.length) {
    stopTour();
    return;
  }
  const step = TOUR_SEQUENCE[tourIndex];
  setState({ selectedId: step.id, compareA: step.id });

  const caption = document.getElementById('tour-caption');
  if (caption) {
    caption.textContent = step.caption;
    caption.classList.add('visible');
  }

  tourIndex++;
  tourTimer = setTimeout(() => advanceTour(), 4000);
}

/* ── Keyboard ────────────────────────────────────────── */
function setupKeyboard() {
  const planetIds = BODIES.filter(b => !b.parent && b.id !== 'blackhole').map(b => b.id);

  document.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts when typing in input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    const st = getState();
    switch (e.key) {
      case ' ':
        e.preventDefault();
        setState({ paused: !st.paused });
        break;
      case 'r':
      case 'R':
        setState({ selectedId: null, tourActive: false });
        stopTour();
        flyToOverview();
        break;
      case 'ArrowLeft': {
        const idx = planetIds.indexOf(st.selectedId);
        const newIdx = Math.max(0, idx - 1);
        setState({ selectedId: planetIds[newIdx], compareA: planetIds[newIdx] });
        break;
      }
      case 'ArrowRight': {
        const idx = planetIds.indexOf(st.selectedId);
        const newIdx = Math.min(planetIds.length - 1, idx + 1);
        setState({ selectedId: planetIds[newIdx], compareA: planetIds[newIdx] });
        break;
      }
      case '/':
        e.preventDefault();
        document.getElementById('search-input').focus();
        break;
      case 'c':
      case 'C':
        setState({ compareOpen: !st.compareOpen });
        break;
      case 't':
      case 'T':
        if (st.tourActive) stopTour();
        else startTour();
        break;
      default:
        // Number keys 1-9 for planets
        const num = parseInt(e.key);
        if (num >= 1 && num <= 9 && num <= planetIds.length) {
          const id = planetIds[num - 1];
          setState({ selectedId: id, compareA: id });
        }
        break;
    }

    // Any user input stops tour
    if (st.tourActive && ['ArrowLeft', 'ArrowRight', ' ', 'Escape'].includes(e.key)) {
      stopTour();
    }
  });

  // Mouse interaction stops tour
  document.getElementById('canvas').addEventListener('mousedown', () => {
    if (getState().tourActive) stopTour();
  });
  document.getElementById('canvas').addEventListener('wheel', () => {
    if (getState().tourActive) stopTour();
  });
}

/* ── State subscriber ────────────────────────────────── */
function subscribeUI() {
  subscribe((st, changed) => {
    if (changed.includes('selectedId') || changed.includes('filter') || changed.includes('query')) {
      renderBodyList();
      renderInfoPanel();
      renderSearchDropdown();
    }
    if (changed.includes('paused')) {
      const btn = document.getElementById('btn-pause');
      if (btn) {
        btn.querySelector('.dock-icon').textContent = st.paused ? '▶' : '⏸';
        btn.querySelector('.dock-label').textContent = st.paused ? 'Play' : 'Pause';
      }
    }
    if (changed.includes('speed')) {
      const readout = document.getElementById('speed-readout');
      if (readout) readout.textContent = st.speed.toFixed(1) + 'x';
      const slider = document.getElementById('speed-slider');
      if (slider) slider.value = st.speed;
    }
    if (changed.includes('elapsedDays')) {
      const el = document.getElementById('elapsed-time');
      if (el) {
        const days = Math.floor(st.elapsedDays);
        const years = (days / 365.25).toFixed(1);
        el.textContent = days < 365 ? `Day ${days}` : `${years} yrs (Day ${days})`;
      }
    }
    if (changed.includes('filter')) {
      document.querySelectorAll('.chip').forEach(c =>
        c.classList.toggle('active', c.dataset.filter === st.filter)
      );
    }
    if (changed.includes('qualityHigh')) {
      const hi = document.getElementById('btn-quality-high');
      const lo = document.getElementById('btn-quality-low');
      if (hi) hi.classList.toggle('active', st.qualityHigh);
      if (lo) lo.classList.toggle('active', !st.qualityHigh);
    }
    if (changed.includes('compareOpen')) {
      const drawer = document.getElementById('compare-drawer');
      if (drawer) drawer.classList.toggle('visible', st.compareOpen);
    }
  });
}

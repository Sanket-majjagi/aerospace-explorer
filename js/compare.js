/*
 * compare.js — Compare drawer: two dropdowns, table, Chart.js bar/radar chart.
 * HOW TO CHANGE:
 *   • Add a compare parameter: add an entry to COMPARE_PARAMS in data.js.
 *   • Change chart type: modify chartType toggle logic.
 *   • Add a new chart: extend renderChart() with a new case.
 */

import { BODIES, BODY_MAP, COMPARE_PARAMS } from './data.js';
import { getState, setState, subscribe } from './state.js';
import { setSelectionRing } from './scene.js';

let chartInstance = null;

export function initCompare() {
  buildCompareDrawer();
  subscribeCompare();
}

function buildCompareDrawer() {
  const drawer = document.getElementById('compare-drawer');
  drawer.innerHTML = `
    <div class="compare-header">
      <h3>Compare Bodies</h3>
      <button class="compare-close" id="compare-close">✕</button>
    </div>
    <div class="compare-selectors">
      <select id="compare-a" class="compare-select"></select>
      <span class="compare-vs">VS</span>
      <select id="compare-b" class="compare-select"></select>
    </div>
    <div class="compare-table-wrap" id="compare-table-wrap"></div>
    <div class="compare-chart-toggle">
      <button class="chart-toggle-btn active" id="chart-bar">Bar</button>
      <button class="chart-toggle-btn" id="chart-radar">Radar</button>
    </div>
    <div class="compare-chart-wrap">
      <canvas id="compare-chart" height="220"></canvas>
    </div>
  `;

  populateSelects();

  document.getElementById('compare-close').addEventListener('click', () => {
    setState({ compareOpen: false });
  });

  document.getElementById('compare-a').addEventListener('change', (e) => {
    setState({ compareA: e.target.value });
  });
  document.getElementById('compare-b').addEventListener('change', (e) => {
    setState({ compareB: e.target.value });
  });

  document.getElementById('chart-bar').addEventListener('click', () => {
    setState({ compareChart: 'bar' });
  });
  document.getElementById('chart-radar').addEventListener('click', () => {
    setState({ compareChart: 'radar' });
  });
}

function populateSelects() {
  const st = getState();
  const options = BODIES.filter(b => b.id !== 'blackhole').map(b =>
    `<option value="${b.id}">${b.name}</option>`
  ).join('');
  const selA = document.getElementById('compare-a');
  const selB = document.getElementById('compare-b');
  if (selA) selA.innerHTML = options;
  if (selB) selB.innerHTML = options;
  if (selA) selA.value = st.compareA || 'earth';
  if (selB) selB.value = st.compareB || 'mars';
}

function renderCompareTable() {
  const st = getState();
  const a = BODY_MAP[st.compareA || 'earth'];
  const b = BODY_MAP[st.compareB || 'mars'];
  if (!a || !b) return;

  const wrap = document.getElementById('compare-table-wrap');
  if (!wrap) return;

  let rows = COMPARE_PARAMS.map(p => {
    const va = typeof a[p.key] === 'number' ? a[p.key] : 0;
    const vb = typeof b[p.key] === 'number' ? b[p.key] : 0;
    const absA = Math.abs(va), absB = Math.abs(vb);
    const aHigher = absA >= absB;
    return `<tr>
      <td>${p.label}</td>
      <td class="${aHigher ? 'highlight' : ''}">${p.format(va)} ${p.unit}</td>
      <td class="${!aHigher ? 'highlight' : ''}">${p.format(vb)} ${p.unit}</td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table class="compare-table">
      <thead><tr><th>Parameter</th><th>${a.name}</th><th>${b.name}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderChart() {
  const st = getState();
  const a = BODY_MAP[st.compareA || 'earth'];
  const b = BODY_MAP[st.compareB || 'mars'];
  if (!a || !b) return;

  const canvasEl = document.getElementById('compare-chart');
  if (!canvasEl) return;

  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  const labels = COMPARE_PARAMS.map(p => p.label);
  const dataA = COMPARE_PARAMS.map(p => {
    const va = Math.abs(typeof a[p.key] === 'number' ? a[p.key] : 0);
    const vb = Math.abs(typeof b[p.key] === 'number' ? b[p.key] : 0);
    const max = Math.max(va, vb, 1);
    return (va / max) * 100;
  });
  const dataB = COMPARE_PARAMS.map(p => {
    const va = Math.abs(typeof a[p.key] === 'number' ? a[p.key] : 0);
    const vb = Math.abs(typeof b[p.key] === 'number' ? b[p.key] : 0);
    const max = Math.max(va, vb, 1);
    return (vb / max) * 100;
  });

  const realA = COMPARE_PARAMS.map(p => `${p.format(typeof a[p.key] === 'number' ? a[p.key] : 0)} ${p.unit}`);
  const realB = COMPARE_PARAMS.map(p => `${p.format(typeof b[p.key] === 'number' ? b[p.key] : 0)} ${p.unit}`);

  const chartType = st.compareChart === 'radar' ? 'radar' : 'bar';

  // Update toggle buttons
  const barBtn = document.getElementById('chart-bar');
  const radarBtn = document.getElementById('chart-radar');
  if (barBtn) barBtn.classList.toggle('active', chartType === 'bar');
  if (radarBtn) radarBtn.classList.toggle('active', chartType === 'radar');

  chartInstance = new Chart(canvasEl, {
    type: chartType,
    data: {
      labels,
      datasets: [
        {
          label: a.name,
          data: dataA,
          backgroundColor: 'rgba(0,220,255,0.35)',
          borderColor: 'rgba(0,220,255,0.9)',
          borderWidth: 2,
          pointBackgroundColor: 'rgba(0,220,255,0.9)'
        },
        {
          label: b.name,
          data: dataB,
          backgroundColor: 'rgba(180,80,255,0.35)',
          borderColor: 'rgba(180,80,255,0.9)',
          borderWidth: 2,
          pointBackgroundColor: 'rgba(180,80,255,0.9)'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: chartType === 'bar' ? {
        y: {
          beginAtZero: true,
          max: 110,
          ticks: { color: '#aaa', callback: v => v + '%' },
          grid: { color: 'rgba(255,255,255,0.06)' }
        },
        x: {
          ticks: { color: '#aaa', font: { size: 10 }, maxRotation: 45 },
          grid: { color: 'rgba(255,255,255,0.04)' }
        }
      } : {
        r: {
          beginAtZero: true,
          max: 110,
          ticks: { display: false },
          grid: { color: 'rgba(255,255,255,0.1)' },
          pointLabels: { color: '#ccc', font: { size: 10 } }
        }
      },
      plugins: {
        legend: { labels: { color: '#ccc' } },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              const idx = ctx.dataIndex;
              const real = ctx.datasetIndex === 0 ? realA[idx] : realB[idx];
              return `${ctx.dataset.label}: ${real} (${ctx.raw.toFixed(0)}%)`;
            }
          }
        }
      }
    }
  });
}

function subscribeCompare() {
  subscribe((st, changed) => {
    if (changed.includes('compareOpen') || changed.includes('compareA') || changed.includes('compareB') || changed.includes('compareChart')) {
      if (st.compareOpen) {
        const selA = document.getElementById('compare-a');
        const selB = document.getElementById('compare-b');
        if (selA && selA.value !== (st.compareA || 'earth')) selA.value = st.compareA || 'earth';
        if (selB && selB.value !== (st.compareB || 'mars')) selB.value = st.compareB || 'mars';
        renderCompareTable();
        renderChart();
        setSelectionRing(st.compareA, st.compareB);
      } else {
        setSelectionRing(null, null);
      }
    }
    if (changed.includes('selectedId') && st.compareOpen) {
      setState({ compareA: st.selectedId || st.compareA });
    }
  });
}

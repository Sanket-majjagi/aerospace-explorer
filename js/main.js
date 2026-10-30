/*
 * main.js — Entry point: init, loading screen, intro, animation loop.
 * HOW TO CHANGE:
 *   • Change intro duration: edit INTRO_DELAY_MS.
 *   • Add a new module: import and call its init() here.
 *   • WebGL fallback message: edit the #webgl-fallback element in HTML.
 */

import { init as initScene, animate as animateScene, handleResize, handleClick, handleMouseMove, runIntroAnimation } from './scene.js';
import { initUI } from './ui.js';
import { initCompare } from './compare.js';
import { setState } from './state.js';

const INTRO_DELAY_MS = 1500;

async function main() {
  // WebGL check
  const canvas = document.getElementById('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) {
    document.getElementById('webgl-fallback').style.display = 'flex';
    document.getElementById('loading-screen').style.display = 'none';
    return;
  }

  const labelContainer = document.getElementById('labels');
  const progressBar = document.getElementById('loading-bar-fill');
  const loadingScreen = document.getElementById('loading-screen');

  // Init scene with progress
  initScene(canvas, labelContainer, (p) => {
    if (progressBar) progressBar.style.width = p + '%';
  });

  // Init UI modules
  initUI();
  initCompare();

  // Set initial compare defaults
  setState({ compareA: 'earth', compareB: 'mars' });

  // Dismiss loading screen
  const dismissLoading = () => {
    loadingScreen.classList.add('fade-out');
    setTimeout(() => {
      loadingScreen.style.display = 'none';
      document.getElementById('hud').classList.add('visible');
      setState({ introComplete: true });
    }, 800);
  };

  // Click to skip intro
  loadingScreen.addEventListener('click', () => {
    dismissLoading();
  });

  // Auto dismiss after intro
  setTimeout(() => {
    if (loadingScreen.style.display !== 'none') {
      dismissLoading();
      runIntroAnimation(() => {});
    }
  }, INTRO_DELAY_MS);

  // Events
  canvas.addEventListener('click', handleClick);
  canvas.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('resize', handleResize);

  // Animation loop
  function loop() {
    requestAnimationFrame(loop);
    animateScene();
  }
  loop();
}

main().catch(err => {
  console.error('Init failed:', err);
  const fallback = document.getElementById('webgl-fallback');
  if (fallback) {
    fallback.style.display = 'flex';
    fallback.querySelector('p').textContent = 'Initialization error: ' + err.message;
  }
});

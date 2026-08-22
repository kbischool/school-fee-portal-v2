// ---------------------------------------------------------------------
// PWA install prompt + service worker registration.
// Shows a small "Install app" pill (bottom-right) on browsers that
// support installing (mainly Android Chrome + desktop Chrome/Edge).
// iOS Safari doesn't support this API — installing there is done via
// Share -> "Add to Home Screen", which just works once manifest.json
// and the apple-touch-icon meta tags are present (already in <head>).
// ---------------------------------------------------------------------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((registration) => {
      // Check for a newer sw.js every time the page loads, not just on
      // whatever schedule the browser feels like.
      registration.update();
    }).catch(() => {});
  });

  // When a new service worker takes over (after a fresh deploy), reload
  // automatically ONCE so the visitor immediately sees the latest version
  // instead of being stuck until they manually refresh.
  let hasReloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hasReloaded) return;
    hasReloaded = true;
    window.location.reload();
  });
}

let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallPill();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const pill = document.getElementById('pwaInstallPill');
  if (pill) pill.remove();
});

function showInstallPill() {
  if (document.getElementById('pwaInstallPill')) return;
  if (window.matchMedia('(display-mode: standalone)').matches) return; // already installed

  const pill = document.createElement('button');
  pill.id = 'pwaInstallPill';
  pill.type = 'button';
  pill.setAttribute('aria-label', 'Install KBIS Fee Portal app');
  pill.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>
    </svg>
    Install app`;
  pill.style.cssText = `
    position: fixed; right: 18px; bottom: 18px; z-index: 60;
    display: flex; align-items: center; gap: 8px;
    background: #0f1b2d; color: #fff; border: none;
    padding: 12px 18px; border-radius: 999px; font-family: Inter, sans-serif;
    font-size: 13px; font-weight: 600; cursor: pointer;
    box-shadow: 0 10px 28px rgba(15,27,45,0.28);
    animation: fadeUp 0.4s cubic-bezier(0.16,1,0.3,1) both;
  `;
  pill.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    pill.remove();
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  });
  document.body.appendChild(pill);
}

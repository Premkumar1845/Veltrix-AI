import { handleRedirect } from './oauth.js';
import { config } from './config.js';
import { renderLanding } from './views/landing.js';
import { gate } from './views/gate.js';
import { renderAuth } from './views/auth.js';
import { getSession } from './supabase.js';

// Apply saved theme immediately to avoid a flash of the wrong palette.
document.documentElement.dataset.theme =
  localStorage.getItem('veltrix.theme') ||
  (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

const root = document.getElementById('root');

export async function enterApp() {
  const { renderShell } = await import('./views/shell.js');
  renderShell(root);
}

export function leaveApp(message) {
  gate(root, message);
}

(async function init() {
  // Check for active Supabase user session
  const session = await getSession();

  if (!session) {
    // If no Supabase session, user must sign in/up first
    renderAuth(root);
    return;
  }

  // Supabase authenticated — handle Google OAuth redirect callback
  try {
    if (await handleRedirect()) {
      await enterApp();
      return;
    }
  } catch (e) {
    // Surface the real error message instead of silently going back to gate.
    console.error('OAuth callback error:', e);
    gate(root, e.message || 'Gmail connection failed. Please try again.');
    return;
  }

  // Always return to the landing page (Connect Gmail) after sign-in
  await renderLanding(root);
})();

import { $, esc, LOGO } from '../utils.js';
import { signIn, signUp } from '../supabase.js';

export function renderAuth(root) {
  root.innerHTML = `
  <div class="auth-page">
    <form class="auth-box" id="authForm">
      <div class="auth-logo-wrap">
        ${LOGO}
        <div class="wordmark-text">Veltrix AI</div>
      </div>
      <h2>Welcome back</h2>
      <p>Sign in to access your intelligent inbox.</p>
      
      <div id="usernameWrap" class="is-hidden">
        <label for="username">Username</label>
        <input id="username" type="text" placeholder="johndoe" autocomplete="username">
      </div>
      
      <label for="email">Email address</label>
      <input id="email" type="email" placeholder="you@example.com" required autocomplete="email">
      
      <label for="password">Password</label>
      <input id="password" type="password" placeholder="••••••••" required autocomplete="current-password">
      
      <p class="err-text" id="authErr"></p>
      
      <button type="submit" class="btn-primary btn-accent" id="submitBtn">Sign In</button>
      
      <div class="auth-toggle">
        <span id="toggleText">Don't have an account?</span>
        <button type="button" class="link-btn" id="toggleBtn" style="padding:0;color:var(--accent)">Sign up</button>
      </div>
    </form>
  </div>`;

  let mode = 'signIn'; // or 'signUp'

  const form = $('#authForm');
  const emailInput = $('#email');
  const passInput = $('#password');
  const usernameWrap = $('#usernameWrap');
  const usernameInput = $('#username');
  const errText = $('#authErr');
  const submitBtn = $('#submitBtn');
  const toggleBtn = $('#toggleBtn');
  const toggleText = $('#toggleText');
  const title = $('h2', form);
  const subtitle = $('p', form);

  const fail = msg => {
    errText.textContent = msg;
    errText.classList.add('show');
  };

  const clearErr = () => {
    errText.textContent = '';
    errText.classList.remove('show');
  };

  toggleBtn.onclick = () => {
    clearErr();
    if (mode === 'signIn') {
      mode = 'signUp';
      title.textContent = 'Create an account';
      subtitle.textContent = 'Sign up to get started with Veltrix AI.';
      submitBtn.textContent = 'Sign Up';
      toggleText.textContent = 'Already have an account?';
      toggleBtn.textContent = 'Sign in';
      usernameWrap.classList.remove('is-hidden');
    } else {
      mode = 'signIn';
      title.textContent = 'Welcome back';
      subtitle.textContent = 'Sign in to access your intelligent inbox.';
      submitBtn.textContent = 'Sign In';
      toggleText.textContent = "Don't have an account?";
      toggleBtn.textContent = 'Sign up';
      usernameWrap.classList.add('is-hidden');
    }
  };

  form.onsubmit = async e => {
    e.preventDefault();
    clearErr();
    const email = emailInput.value.trim();
    const pass = passInput.value;
    const username = usernameInput.value.trim();

    if (!email || !pass) {
      fail('Please enter both email and password.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Please wait…';

    try {
      if (mode === 'signIn') {
        await signIn(email, pass);
      } else {
        if (!username) {
          throw new Error('Please enter a username.');
        }
        await signUp(email, pass, username);
      }
      
      // Reload the app to re-run the main.js boot logic
      location.reload();
      
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = mode === 'signIn' ? 'Sign In' : 'Sign Up';
      fail(err.message || 'Authentication failed. Please try again.');
    }
  };
}

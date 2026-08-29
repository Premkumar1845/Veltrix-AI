import { $, esc, LOGO } from '../utils.js';
import { signIn, signUp } from '../supabase.js';

export function renderAuth(root) {
  root.innerHTML = `
  <div class="auth-page">
    <form class="auth-box" id="authForm">
      <div class="wordmark" style="justify-content:center;margin-bottom:24px">${LOGO}Veltrix AI</div>
      <h2>Welcome back</h2>
      <p>Sign in to access your intelligent inbox.</p>
      
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
    } else {
      mode = 'signIn';
      title.textContent = 'Welcome back';
      subtitle.textContent = 'Sign in to access your intelligent inbox.';
      submitBtn.textContent = 'Sign In';
      toggleText.textContent = "Don't have an account?";
      toggleBtn.textContent = 'Sign up';
    }
  };

  form.onsubmit = async e => {
    e.preventDefault();
    clearErr();
    const email = emailInput.value.trim();
    const pass = passInput.value;

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
        await signUp(email, pass);
        // Supabase sign up might require email confirmation, 
        // but for now, we'll try to just reload.
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

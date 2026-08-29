// Runtime config. The OAuth Client ID is a public identifier — safe client-side.
// No client secret is used anywhere: the browser token flow requires none.
export const config = {
  // Production Client ID. Replace this with your Google Cloud Client ID.
  clientId: 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com',
  // Supabase Configuration
  supabaseUrl: 'https://yqyaswbbztepvzwzbtuf.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxeWFzd2JienRlcHZ6d3pidHVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5OTMxNjMsImV4cCI6MjEwMzU2OTE2M30.U8acOw-4XE4lcm3zPu2vjoF6yT6ZoVFjiUg4DqW0djk',
  demoMode: localStorage.getItem('veltrix.mode') === 'demo',
  scopes: [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/userinfo.profile',
  ].join(' '),
};

export function setClientId(id) {
  config.clientId = id;
}

export function setMode(m) {
  config.demoMode = m === 'demo';
  localStorage.setItem('veltrix.mode', m);
}

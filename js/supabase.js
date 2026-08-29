import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { config } from './config.js';

let supabase = null;

try {
  // Only initialize if the URL is valid, to prevent crashing the app 
  // before the user replaces the placeholders.
  if (config.supabaseUrl.startsWith('https://')) {
    supabase = createClient(config.supabaseUrl, config.supabaseKey);
  }
} catch (e) {
  console.error('Failed to initialize Supabase client', e);
}

export function getClient() {
  return supabase;
}

export async function getSession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('Supabase session error:', error.message);
    return null;
  }
  return data.session;
}

export async function signIn(email, password) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

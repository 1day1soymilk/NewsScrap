import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase env vars are not set. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env',
  )
}

// createClient throws synchronously if given an empty string (e.g. `supabaseUrl is required.`),
// and this module is imported at the top of the app's module graph, so that throw would happen
// during module evaluation, before React ever mounts — the whole app would render as a blank
// page instead of the documented empty-state UI. When the real env vars are absent, fall back to
// syntactically valid placeholders so the client constructs successfully; actual requests will
// then fail at call time and surface through the app's existing error handling / empty state.
// Do NOT change these back to '' — that reintroduces the module-level throw.
// Use `||`, not `??`, deliberately: a declared-but-blank .env value (e.g. `VITE_SUPABASE_URL=`)
// is read by Vite as `''`, not `undefined`/`null`, so `??` would let the empty string through
// and reintroduce the same throw. `||` treats '' the same as missing, matching the falsy check
// in the warning above. Do not "modernize" this back to `??`.
export const supabase = createClient(
  supabaseUrl || 'http://localhost:54321',
  supabaseAnonKey || 'placeholder-anon-key',
)

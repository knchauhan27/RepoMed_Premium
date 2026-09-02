// Supabase Configuration
// Replace these with your actual Supabase project URL and API key
// Get these from: https://app.supabase.com/project/[YOUR_PROJECT]/api?page=urls

const SUPABASE_URL = "https://hkludzlqmousehefgnrt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrbHVkemxxbW91c2VoZWZnbnJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMzg1MDEsImV4cCI6MjEwMzgxNDUwMX0.xzJwuT_9h5LHGfCfYekfWMGekWs-A14higpWjXpFkdY";

// Initialize Supabase Client
const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Export for use in other files
window.supabaseClient = supabaseClient;

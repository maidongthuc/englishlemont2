// Google sign-in through Supabase Auth
/* ---------- Đăng nhập bằng Google (Supabase Auth) ---------- */
const SUPABASE_URL = window.APP_CONFIG.supabaseUrl;
const SUPABASE_KEY = window.APP_CONFIG.supabaseKey;
const CONFIG_PROBLEM = window.APP_CONFIG.configProblem;
const sb = SUPABASE_URL && SUPABASE_KEY && window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

async function accessToken() {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || "";
}

$("google-signin").addEventListener("click", async () => {
  $("login-msg").textContent = "";
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) $("login-msg").textContent = `Could not sign in: ${error.message}`;
});
$("signout").addEventListener("click", async () => {
  await sb.auth.signOut().catch(() => {});
  location.reload();
});

function showSignedIn(user) {
  const meta = user.user_metadata || {};
  $("user-name").textContent = meta.full_name || meta.name || user.email || "";
  if (meta.avatar_url) { $("user-avatar").src = meta.avatar_url; $("user-avatar").hidden = false; }
  $("userbar").hidden = false;
}

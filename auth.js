// RepoMed authentication and session UI for both index.html and subject.html.
const AUTH_RETURN_PATH_KEY = "repoMedAuthReturnPath";
const AUTH_PENDING_KEY = "repoMedAuthPending";

function currentRelativePath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function safeRelativePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

function rememberReturnPath(path = currentRelativePath()) {
  const safePath = safeRelativePath(path);
  if (!safePath) return null;
  sessionStorage.setItem(AUTH_RETURN_PATH_KEY, safePath);
  sessionStorage.setItem(AUTH_PENDING_KEY, "true");
  return safePath;
}

function getReturnPath() {
  return safeRelativePath(sessionStorage.getItem(AUTH_RETURN_PATH_KEY));
}

function clearReturnPath() {
  sessionStorage.removeItem(AUTH_RETURN_PATH_KEY);
  sessionStorage.removeItem(AUTH_PENDING_KEY);
  sessionStorage.removeItem("redirectAfterLogin");
  sessionStorage.removeItem("openAuthModal");
}

function setAuthUi(session) {
  const signInBtn = document.getElementById("sign-in-btn");
  const userMenu = document.getElementById("user-menu");
  const userEmail = document.getElementById("user-email");
  if (!signInBtn || !userMenu) return;

  if (session?.user) {
    signInBtn.style.display = "none";
    userMenu.classList.remove("hidden");
    if (userEmail) userEmail.textContent = session.user.email || "Account";
  } else {
    signInBtn.style.display = "block";
    userMenu.classList.add("hidden");
    if (userEmail) userEmail.textContent = "";
  }
}

function finishPendingReturn(session) {
  if (!session?.user || sessionStorage.getItem(AUTH_PENDING_KEY) !== "true") return;
  const returnPath = getReturnPath();
  clearReturnPath();
  if (returnPath && returnPath !== currentRelativePath()) window.location.assign(returnPath);
}

function openAuthModalIfRequested(authModal) {
  const params = new URLSearchParams(window.location.search);
  const shouldOpen = params.get("auth") === "signin" || sessionStorage.getItem("openAuthModal") === "true";
  if (!shouldOpen || !authModal) return;

  sessionStorage.removeItem("openAuthModal");
  params.delete("auth");
  window.history.replaceState({}, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
  authModal.classList.add("active");
}

async function beginGoogleAuth() {
  const returnPath = getReturnPath() || rememberReturnPath();
  if (!returnPath) throw new Error("Unable to determine a safe return path");

  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: new URL(returnPath, window.location.origin).href,
      scopes: "profile email",
    },
  });
  if (error) {
    sessionStorage.removeItem(AUTH_PENDING_KEY);
    throw error;
  }
}

function initializeAuth() {
  const authModal = document.getElementById("auth-modal");
  const signInBtn = document.getElementById("sign-in-btn");
  const logoutBtn = document.getElementById("logout-btn");
  const closeAuthModalBtn = document.getElementById("close-auth-modal");
  const signInForm = document.getElementById("sign-in-form");
  const signUpForm = document.getElementById("sign-up-form");
  const switchToSignupBtn = document.getElementById("switch-to-signup");
  const switchToSigninBtn = document.getElementById("switch-to-signin");
  const googleSigninBtn = document.getElementById("google-signin-btn");
  const googleSignupBtn = document.getElementById("google-signup-btn");
  const signinEmail = document.getElementById("signin-email");
  const signinPassword = document.getElementById("signin-password");
  const signinSubmitBtn = document.getElementById("signin-submit");
  const signupName = document.getElementById("signup-name");
  const signupEmail = document.getElementById("signup-email");
  const signupPassword = document.getElementById("signup-password");
  const signupSubmitBtn = document.getElementById("signup-submit");
  const aboutBtn = document.getElementById("about-btn");
  const aboutModal = document.getElementById("about-modal");
  const closeAboutModalBtn = document.getElementById("close-about-modal");
  const closeAboutBtn = document.getElementById("close-about-btn");

  if (signInBtn) {
    signInBtn.addEventListener("click", () => {
      rememberReturnPath();
      if (authModal) authModal.classList.add("active");
      else window.location.assign("index.html?auth=signin");
    });
  }
  if (closeAuthModalBtn && authModal) closeAuthModalBtn.addEventListener("click", () => authModal.classList.remove("active"));
  if (authModal) authModal.addEventListener("click", (event) => { if (event.target === authModal) authModal.classList.remove("active"); });
  if (switchToSignupBtn && signInForm && signUpForm) switchToSignupBtn.addEventListener("click", () => { signInForm.classList.remove("active"); signUpForm.classList.add("active"); });
  if (switchToSigninBtn && signInForm && signUpForm) switchToSigninBtn.addEventListener("click", () => { signUpForm.classList.remove("active"); signInForm.classList.add("active"); });
  if (aboutBtn && aboutModal) aboutBtn.addEventListener("click", () => aboutModal.classList.add("active"));
  if (closeAboutModalBtn && aboutModal) closeAboutModalBtn.addEventListener("click", () => aboutModal.classList.remove("active"));
  if (closeAboutBtn && aboutModal) closeAboutBtn.addEventListener("click", () => aboutModal.classList.remove("active"));
  if (aboutModal) aboutModal.addEventListener("click", (event) => { if (event.target === aboutModal) aboutModal.classList.remove("active"); });

  const startGoogle = async () => {
    try { await beginGoogleAuth(); }
    catch (error) { alert(`Error signing in with Google: ${error.message}`); }
  };
  if (googleSigninBtn) googleSigninBtn.addEventListener("click", startGoogle);
  if (googleSignupBtn) googleSignupBtn.addEventListener("click", startGoogle);

  if (signinSubmitBtn && signinEmail && signinPassword) {
    signinSubmitBtn.addEventListener("click", async () => {
      const email = signinEmail.value.trim();
      const password = signinPassword.value;
      if (!email || !password) return alert("Please fill in all fields");
      try {
        signinSubmitBtn.disabled = true;
        signinSubmitBtn.textContent = "Signing in...";
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (authModal) authModal.classList.remove("active");
        signinEmail.value = "";
        signinPassword.value = "";
        const { data: { session } } = await supabaseClient.auth.getSession();
        setAuthUi(session);
        finishPendingReturn(session);
      } catch (error) { alert(`Error signing in: ${error.message}`); }
      finally { signinSubmitBtn.disabled = false; signinSubmitBtn.textContent = "Sign In"; }
    });
  }

  if (signupSubmitBtn && signupName && signupEmail && signupPassword && signInForm && signUpForm) {
    signupSubmitBtn.addEventListener("click", async () => {
      const fullName = signupName.value.trim();
      const email = signupEmail.value.trim();
      const password = signupPassword.value;
      if (!fullName || !email || !password) return alert("Please fill in all fields");
      if (password.length < 6) return alert("Password must be at least 6 characters");
      try {
        signupSubmitBtn.disabled = true;
        signupSubmitBtn.textContent = "Creating account...";
        const { error } = await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: fullName }, emailRedirectTo: window.location.href } });
        if (error) throw error;
        alert("Account created! Check your email to verify your account.");
        signUpForm.classList.remove("active");
        signInForm.classList.add("active");
        signupName.value = ""; signupEmail.value = ""; signupPassword.value = "";
      } catch (error) { alert(`Error creating account: ${error.message}`); }
      finally { signupSubmitBtn.disabled = false; signupSubmitBtn.textContent = "Create Account"; }
    });
  }

  if (logoutBtn && !logoutBtn.dataset.listenerAdded) {
    logoutBtn.dataset.listenerAdded = "true";
    logoutBtn.addEventListener("click", async () => {
      try {
        logoutBtn.disabled = true;
        logoutBtn.textContent = "Signing out...";
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
        clearReturnPath();
        setAuthUi(null);
      } catch (error) { alert(`Error signing out: ${error.message}`); }
      finally { logoutBtn.disabled = false; logoutBtn.textContent = "Sign Out"; }
    });
  }

  async function refreshSessionUi() {
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      setAuthUi(session);
      if (session) finishPendingReturn(session);
      else openAuthModalIfRequested(authModal);
    } catch (error) {
      console.error("Unable to read authentication session:", error);
      setAuthUi(null);
    }
  }

  supabaseClient.auth.onAuthStateChange((event, session) => {
    setAuthUi(session);
    if (event === "SIGNED_IN") finishPendingReturn(session);
  });
  refreshSessionUi();
}

window.RepoMedAuth = { rememberReturnPath, setAuthUi };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeAuth);
else initializeAuth();

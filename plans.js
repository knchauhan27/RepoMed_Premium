/**
 * RepoMed - Pricing & Checkout Logic
 * Handles product pricing display and payment checkout flow
 */

"use strict";

// ============================================================
// UTILITIES
// ============================================================

/**
 * Format price in paise (lowest currency unit) to rupees
 * @param {number} paise - Amount in paise
 * @returns {string} Formatted price (₹X.XX)
 */
function formatPrice(paise) {
  return `₹${(paise / 100).toFixed(2)}`;
}

/**
 * Navigate to checkout page for a product
 * @param {string} productCode - Product code (e.g., "ANATOMY_2024", "GOLD")
 */
function navigateToCheckout(productCode) {
  location.href = `checkout.html?product=${encodeURIComponent(productCode)}`;
}

// ============================================================
// API CALLS
// ============================================================

/**
 * Fetch all available products from backend
 * @async
 * @returns {Promise<Array>} Array of product objects
 * @throws {Error} If API call fails
 */
async function fetchProducts() {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/get-products`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Unable to load plans");
  }

  return data.products;
}

// ============================================================
// RENDERING
// ============================================================

/**
 * Generate HTML for a product card
 * @param {Object} product - Product object from API
 * @returns {string} HTML string for product card
 */
function renderProductCard(product) {
  const subjects = product.all_access
    ? ["All RepoMed subjects"]
    : product.product_subjects.map((s) => s.subject_key);

  const isGold = product.all_access;
  const displayName = product.code === "GOLD"
    ? "GOLD"
    : product.name.replace("RepoMed ", "");

  return `
    <article class="plan ${isGold ? "gold" : ""}">
      <p class="eyebrow">${product.code}</p>
      <h2>${product.name}</h2>
      <p class="muted">${product.academic_year}</p>
      <ul>
        ${subjects.map((s) => `<li>${s}</li>`).join("")}
      </ul>
      <p class="price">${formatPrice(product.price_paise)} <small>/ year</small></p>
      <button class="button" data-product="${product.code}">
        Get ${displayName}
      </button>
    </article>
  `;
}

/**
 * Display error message on pricing page
 * @param {string} message - Error message to display
 */
function showPricingError(message) {
  const plansContainer = document.querySelector(".plans");
  if (plansContainer) {
    plansContainer.insertAdjacentHTML(
      "afterbegin",
      `<p class="error">${escapeHtml(message)}</p>`
    );
  }
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// ============================================================
// PRICING PAGE
// ============================================================

/**
 * Initialize pricing page with product listings
 * Fetches products and renders plan cards
 */
async function initializePricingPage() {
  try {
    const products = await fetchProducts();

    // Separate into bundle plans and gold plan
    const bundlePlans = products.filter((p) => !p.all_access);
    const goldPlans = products.filter((p) => p.all_access);

    // Render bundle plans
    const bundleContainer = document.querySelector("#bundle-plans");
    if (bundleContainer) {
      bundleContainer.innerHTML = bundlePlans.map(renderProductCard).join("");
    }

    // Render gold plan
    const goldContainer = document.querySelector("#gold-plan");
    if (goldContainer) {
      goldContainer.innerHTML = goldPlans.map(renderProductCard).join("");
    }

    // Attach event listeners to product buttons
    document.querySelectorAll("[data-product]").forEach((button) => {
      button.addEventListener("click", () => {
        navigateToCheckout(button.dataset.product);
      });
    });
  } catch (error) {
    console.error("Failed to load pricing:", error);
    showPricingError(error.message);
  }
}

// ============================================================
// CHECKOUT PAGE
// ============================================================

/**
 * Update checkout summary with current pricing
 * Handles discount calculations and payment button states
 * @param {Object} productData - Product data from API
 * @param {Object|null} discountQuote - Optional discount data
 */
function updateCheckoutSummary(productData, discountQuote) {
  // A valid 100% coupon has a final amount of zero. Use nullish fallbacks,
  // not truthiness, so zero remains an intentional quoted price.
  const originalAmount = discountQuote?.originalAmount ?? productData.price_paise;
  const discountAmount = discountQuote?.discountAmount ?? 0;
  const finalAmount = discountQuote?.finalAmount ?? productData.price_paise;

  // Update pricing display
  const originalEl = document.querySelector("#original");
  const finalEl = document.querySelector("#final");
  const discountEl = document.querySelector("#discount");
  const discountRow = document.querySelector("#discount-row");
  const payBtn = document.querySelector("#pay");

  if (originalEl) originalEl.textContent = formatPrice(originalAmount);
  if (finalEl) finalEl.textContent = formatPrice(finalAmount);
  if (discountEl) discountEl.textContent = `−${formatPrice(discountAmount)}`;
  if (discountRow) discountRow.classList.toggle("hidden", !discountAmount);
  if (payBtn) {
    payBtn.textContent = finalAmount === 0 ? "Activate Premium" : "Proceed to payment";
  }
}

async function fetchMyEntitlements(accessToken) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/get-my-entitlements`, {
    headers: { Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || "Unable to load your active plans");
  return Array.isArray(data?.entitlements) ? data.entitlements : [];
}

function activePlanForProduct(entitlements, productCode) {
  return entitlements.find((entry) => {
    const product = entry.products || {};
    return product.code === productCode || product.all_access === true;
  }) || null;
}

/**
 * Apply referral code to checkout
 * Validates code and updates pricing if applicable
 * @param {string} referralCode - Referral code to apply
 * @param {string} productCode - Product being purchased
 */
async function applyReferralCode(referralCode, productCode) {
  if (!referralCode.trim()) return;

  try {
    const { data, error } = await supabaseClient.functions.invoke(
      "validate-referral-code",
      {
        body: {
          referralCode: referralCode.trim(),
          productCode: productCode,
        },
      }
    );

    const quoteEl = document.querySelector("#quote");

    if (error || !data?.valid) {
      if (quoteEl) {
        quoteEl.textContent = data?.error || "Referral code is not valid for this plan.";
      }
      return null;
    }

    if (quoteEl) quoteEl.textContent = "";
    return data;
  } catch (error) {
    console.error("Error validating referral code:", error);
    const quoteEl = document.querySelector("#quote");
    if (quoteEl) quoteEl.textContent = "Error validating code. Please try again.";
    return null;
  }
}

/**
 * Proceed to Razorpay payment
 * Creates payment order and initializes Razorpay checkout
 * @param {Object} productData - Product being purchased
 * @param {string|null} referralCode - Optional referral code
 * @param {string} userToken - User's JWT auth token
 */
async function proceedToPayment(productData, referralCode, userToken, quote = null) {
  try {
    if (quote?.finalAmount === 0 && quote.code === referralCode?.trim().toUpperCase()) {
      const { data, error } = await supabaseClient.functions.invoke("redeem-free-referral", {
        headers: { Authorization: `Bearer ${userToken}` },
        body: { referralCode: quote.code, productCode: productData.code },
      });
      if (error || !data?.premium) throw new Error(data?.error || "Unable to activate this referral plan");
      alert("Referral redeemed. Your plan is now active.");
      location.href = "index.html";
      return;
    }

    // Create payment order
    const { data, error } = await supabaseClient.functions.invoke(
      "create-razorpay-order",
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
        body: {
          productCode: productData.code,
          referralCode: referralCode || undefined,
        },
      }
    );

    if (error || !data) {
      throw new Error(data?.error || "Failed to create payment order");
    }

    // Initialize Razorpay
    const options = {
      key: data.keyId,
      amount: data.amount,
      currency: data.currency,
      order_id: data.razorpayOrderId,
      name: "RepoMed",
      description: `${data.productName} - ${data.productCode}`,
      image: "./favicon_io/favicon-32x32.png",
      handler: async (response) => {
        verifyPayment(response, data.paymentOrderId, userToken);
      },
      prefill: {
        email: sessionStorage.getItem("userEmail") || "",
        name: sessionStorage.getItem("userName") || "",
      },
      theme: {
        color: "#5b4cf5",
      },
    };

    const razorpay = new Razorpay(options);
    razorpay.open();
  } catch (error) {
    console.error("Payment initialization error:", error);
    alert(`Payment Error: ${error.message}`);
  }
}

/**
 * Verify Razorpay payment and finalize entitlement
 * @param {Object} response - Razorpay payment response
 * @param {string} paymentOrderId - Local payment order ID
 * @param {string} userToken - User's JWT auth token
 */
async function verifyPayment(response, paymentOrderId, userToken) {
  try {
    const { data, error } = await supabaseClient.functions.invoke(
      "verify-razorpay-payment",
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
        body: {
          razorpayOrderId: response.razorpay_order_id,
          razorpayPaymentId: response.razorpay_payment_id,
          razorpaySignature: response.razorpay_signature,
          paymentOrderId: paymentOrderId,
        },
      }
    );

    if (error) {
      throw error;
    }

    alert("Payment verified. Premium access is now active.");
    setTimeout(() => {
      location.href = "index.html";
    }, 2000);
  } catch (error) {
    console.error("Payment verification error:", error);
    alert(`Payment could not be verified: ${error.message}`);
  }
}

/**
 * Initialize checkout page
 * Loads product details and sets up checkout form
 */
async function initializeCheckoutPage() {
  const errorEl = document.querySelector("#error");
  const productCode = new URLSearchParams(location.search).get("product")?.toUpperCase();

  try {
    // Get current session
    const { data: authData, error: authError } = await supabaseClient.auth.getSession();
    if (authError || !authData.session) {
      errorEl.textContent = "Please sign in before purchasing.";
      return;
    }

    const session = authData.session;
    const userToken = session.access_token;

    // Store user info for payment form
    sessionStorage.setItem("userEmail", session.user.email || "");
    sessionStorage.setItem("userName", session.user.user_metadata?.full_name || "RepoMed Student");

    // Fetch products
    const products = await fetchProducts();
    const product = products.find((p) => p.code === productCode);

    if (!product) {
      throw new Error("The selected product is unavailable.");
    }

    let activePlan = null;
    try {
      activePlan = activePlanForProduct(await fetchMyEntitlements(userToken), product.code);
    } catch (error) {
      // Order creation independently enforces this rule server-side. Do not
      // make checkout unusable merely because this optional UI lookup failed.
      console.warn("Unable to pre-check active plans", error);
    }

    // Show checkout panel
    const panel = document.querySelector("#checkout-panel");
    if (panel) panel.classList.remove("hidden");

    // Populate product details
    const codeEl = document.querySelector("#product-code");
    const nameEl = document.querySelector("#product-name");
    const yearEl = document.querySelector("#academic-year");
    const identityEl = document.querySelector("#identity");
    const subjectsEl = document.querySelector("#subjects");

    if (codeEl) codeEl.textContent = product.code;
    if (nameEl) nameEl.textContent = product.name;
    if (yearEl) yearEl.textContent = product.academic_year;
    if (identityEl) {
      identityEl.textContent = `${session.user.user_metadata?.full_name || "RepoMed Student"} · ${session.user.email}`;
    }

    if (subjectsEl) {
      const subjects = product.all_access
        ? ["All RepoMed subjects"]
        : product.product_subjects.map((s) => s.subject_key);
      subjectsEl.innerHTML = subjects.map((s) => `<li>${s}</li>`).join("");
    }

    // Initialize pricing display
    updateCheckoutSummary(product, null);

    // Setup referral code application
    const applyBtn = document.querySelector("#apply");
    const referralInput = document.querySelector("#referral");

    if (activePlan) {
      const activeProduct = activePlan.products || {};
      const planName = activeProduct.name || activeProduct.code || "this plan";
      const expiry = new Date(activePlan.expires_at).toLocaleDateString("en-IN", {
        day: "numeric", month: "short", year: "numeric",
      });
      if (referralInput) referralInput.disabled = true;
      if (applyBtn) applyBtn.hidden = true;
      const quoteEl = document.querySelector("#quote");
      if (quoteEl) quoteEl.textContent = `${planName} is already active until ${expiry}.`;
      const payBtn = document.querySelector("#pay");
      if (payBtn) {
        payBtn.disabled = true;
        payBtn.textContent = "Plan already active";
      }
      return;
    }

    let currentQuote = null;

    if (applyBtn) {
      applyBtn.addEventListener("click", async () => {
        const referralCode = referralInput?.value.trim();
        if (referralCode) {
          const quote = await applyReferralCode(referralCode, product.code);
          if (quote) {
            currentQuote = quote;
            updateCheckoutSummary(product, quote);
          }
        }
      });
    }

    if (referralInput) {
      referralInput.addEventListener("input", () => {
        currentQuote = null;
        updateCheckoutSummary(product, null);
      });
    }

    // Setup payment button
    const payBtn = document.querySelector("#pay");
    if (payBtn) {
      payBtn.addEventListener("click", () => {
        const referralCode = referralInput?.value.trim();
        proceedToPayment(product, referralCode, userToken, currentQuote);
      });
    }
  } catch (error) {
    console.error("Checkout initialization error:", error);
    errorEl.textContent = error.message;
  }
}

// ============================================================
// PAGE INITIALIZATION
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const isCheckoutPage = location.pathname.endsWith("checkout.html");
  if (isCheckoutPage) {
    initializeCheckoutPage();
  } else {
    initializePricingPage();
  }
});

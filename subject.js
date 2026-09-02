/**
 * ============================================================
 * RepoMed — subject.js  (v3)
 * Dynamic PYQ Subject Page Logic
 *
 * Changes in v3:
 *   • Year, Topic, Subtopic → multi-select chip groups (like Type)
 *   • "Last 5 Years" / "Last 10 Years" quick-select buttons
 *   • PDF export via jsPDF (cover page + watermark + footer)
 *   • CSV export retained
 *
 * Architecture:
 *   State   → Single source of truth for all filters/sort/search
 *   Data    → Filtering, sorting, and pagination all happen server-side
 *             (Edge Function); the browser only sends filter criteria and
 *             renders whatever comes back.
 *   Render  → Pure DOM update from State.allQuestions
 * ============================================================
 */

"use strict";

/* ============================================================
   MODULE: App State
   All sets are multi-select; empty set = "All" (no filter).
   ============================================================ */
const State = (() => {
  let _state = {
    subject: "",
    allQuestions: [],
    totalQuestions: 0,
    pagination: { page: 0, limit: 250, hasMore: false },
    filterOptions: { years: [], topics: [], subtopics: [], exams: [], marks: [], types: [] },
    access: { isPremium: false, previewLimit: 10 },
    searchQuery: "",
    filters: {
      years: new Set(), // ← now multi-select Set
      topics: new Set(), // ← now multi-select Set
      subtopics: new Set(), // ← now multi-select Set
      exams: new Set(), // new exam filter
      marks: "", // single select (dropdown)
      types: new Set(), // multi-select (unchanged)
    },
    sort: { by: "year", order: "desc" },
  };

  return {
    get: (key) => (key ? _state[key] : { ..._state }),
    set: (key, value) => {
      _state[key] = value;
    },

    // Generic toggle for any Set-based filter
    toggleSetFilter: (filterKey, value) => {
      const s = _state.filters[filterKey];
      s.has(value) ? s.delete(value) : s.add(value);
    },

    // Replace a Set filter entirely (used for last-5/last-10)
    setSetFilter: (filterKey, valuesArray) => {
      _state.filters[filterKey] = new Set(valuesArray);
    },

    setFilter: (key, value) => {
      _state.filters[key] = value;
    },
    getFilter: (key) => _state.filters[key],

    resetFilters: () => {
      _state.filters = {
        years: new Set(),
        topics: new Set(),
        subtopics: new Set(),
        exams: new Set(),
        marks: "",
        types: new Set(),
      };
      _state.searchQuery = "";
    },

    setSort: (key, value) => {
      _state.sort[key] = value;
    },
    getSort: () => ({ ..._state.sort }),
  };
})();

function buildQuestionRequest({ page = 0, pageSize = 250, includeOptions = true } = {}) {
  const filters = State.get("filters");
  const sort = State.getSort();
  return {
    subject: State.get("subject"),
    years: [...filters.years],
    topics: [...filters.topics],
    subtopics: [...filters.subtopics],
    exams: [...filters.exams],
    marks: filters.marks || null,
    types: [...filters.types],
    search: State.get("searchQuery"),
    sortBy: sort.by,
    sortOrder: sort.order,
    page,
    pageSize,
    includeOptions,
  };
}

const DeviceIdentity = (() => {
  const storageKey = "repomed_device_token_v1";
  function token() {
    let value = localStorage.getItem(storageKey);
    if (/^[A-Za-z0-9_-]{32,128}$/.test(value || "")) return value;
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    value = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    localStorage.setItem(storageKey, value);
    return value;
  }
  return { token };
})();

/* ============================================================
   MODULE: Data Loader
   ============================================================ */
const DataLoader = (() => {
  async function loadData(paging) {
    const { data, error } = await supabaseClient.functions.invoke(
      "get-questions",
      { body: buildQuestionRequest(paging), headers: { "x-repomed-device": DeviceIdentity.token() } },
    );
    if (error) throw error;
    if (!data || !Array.isArray(data.questions) || typeof data.total !== "number") {
      throw new Error("Question service returned an invalid response");
    }
    return data;
  }

  return { loadData };
})();

async function getFunctionErrorMessage(error, fallback) {
  try {
    if (error?.context instanceof Response) {
      const body = await error.context.json();
      return body.error || fallback;
    }
  } catch (_) {
    // Use the safe fallback below when an error body is unavailable.
  }
  return error?.message || fallback;
}

const PremiumPayment = (() => {
  const subjectProducts = {
    Anatomy: "EMBRYO", Physiology: "EMBRYO", Biochemistry: "EMBRYO",
    Patho: "SYNAPSE", Pharmac: "SYNAPSE", Micro: "SYNAPSE",
    "PSM/CM": "NEXUS", FM: "NEXUS", ENT: "NEXUS", Ophthal: "NEXUS",
    Medicine: "APEX", Surgery: "APEX", Obstetrics: "APEX", Gynaecology: "APEX", Pediatrics: "APEX",
  };
  async function validateReferral() {
    const input = DOM.get("referral-code");
    const code = input?.value.trim();
    if (!code) return null;
    const { data, error } = await supabaseClient.functions.invoke("validate-referral-code", { body: { referralCode: code } });
    if (error || !data?.valid) throw new Error("Referral code is not valid or unavailable");
    alert(`Referral ${data.code}: -₹${(data.discountAmount / 100).toFixed(2)}. You pay ₹${(data.finalAmount / 100).toFixed(2)}.`);
    return { code: data.code, finalAmount: data.finalAmount };
  }

  function updateUi(access) {
    const button = DOM.get("btn-get-premium");
    if (!button) return;
    const product = subjectProducts[State.get("subject")];
    button.hidden = Boolean(access.isPremium) || !product;
    button.disabled = false;
    button.textContent = `View ${product} plan`;
    const referralControl = DOM.get("referral-control");
    if (referralControl) referralControl.hidden = Boolean(access.isPremium);
  }

  function renderPreviewCta(access) {
    const panel = DOM.get("preview-cta");
    const product = subjectProducts[State.get("subject")];
    if (!panel || access?.isPremium || !product) { if (panel) panel.hidden = true; return; }
    const planSubjects = {
      EMBRYO: "Anatomy • Physiology • Biochemistry",
      SYNAPSE: "Pathology • Pharmacology • Microbiology",
      NEXUS: "PSM • FMT • ENT • Ophthalmology",
      APEX: "Medicine • Surgery • OBGY • Pediatrics",
    };
    DOM.get("preview-cta-title").textContent = access?.reason === "subject_not_in_active_plan"
      ? `Your current plan does not include ${State.get("subject")}.`
      : `Unlock all ${State.get("subject")} PYQs with RepoMed ${product}.`;
    DOM.get("preview-cta-detail").textContent = access?.reason === "subject_not_in_active_plan"
      ? `Choose RepoMed ${product} for this subject. Includes ${planSubjects[product]} · ₹249/year`
      : `Includes ${planSubjects[product]} · ₹249/year`;
    DOM.get("preview-cta-link").href = `checkout.html?product=${encodeURIComponent(product)}`;
    panel.hidden = false;
  }

  async function startCheckout() {
    const button = DOM.get("btn-get-premium");
    if (!button || button.disabled) return;
    const product = subjectProducts[State.get("subject")];
    if (product) {
      window.location.href = `checkout.html?product=${encodeURIComponent(product)}`;
      return;
    }

    try {
      button.disabled = true;
      button.textContent = "Preparing checkout…";
      const referral = await validateReferral();
      if (referral?.finalAmount === 0) {
        const { data, error } = await supabaseClient.functions.invoke("redeem-free-referral", { body: { referralCode: referral.code } });
        if (error || !data?.premium) throw new Error(await getFunctionErrorMessage(error, "Unable to redeem referral code"));
        await applyAndRender();
        alert("Referral redeemed. Premium access is now active.");
        return;
      }
      const { data: order, error: orderError } = await supabaseClient.functions.invoke(
        "create-razorpay-order",
        { body: referral ? { referralCode: referral.code } : {} },
      );
      if (orderError) throw new Error(await getFunctionErrorMessage(orderError, "Unable to create payment order"));
      if (!window.Razorpay) throw new Error("Razorpay Checkout did not load. Please refresh and try again.");

      const { data: { session } } = await supabaseClient.auth.getSession();
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "RepoMed",
        description: "Premium access (Test Mode)",
        order_id: order.razorpayOrderId,
        prefill: { email: session?.user?.email || "" },
        theme: { color: "#5b4cf5" },
        handler: async (paymentResponse) => {
          try {
            button.textContent = "Verifying payment…";
            const { data: verification, error: verificationError } = await supabaseClient.functions.invoke(
              "verify-razorpay-payment",
              {
                body: {
                  paymentOrderId: order.paymentOrderId,
                  razorpayPaymentId: paymentResponse.razorpay_payment_id,
                  razorpayOrderId: paymentResponse.razorpay_order_id,
                  razorpaySignature: paymentResponse.razorpay_signature,
                },
              },
            );
            if (verificationError || !verification?.premium) {
              throw new Error(await getFunctionErrorMessage(verificationError, "Payment verification failed"));
            }
            await applyAndRender();
            alert("Payment verified. Premium access is now active.");
          } catch (error) {
            alert(`Payment could not be verified: ${error.message}`);
          } finally {
            const access = State.get("access");
            updateUi(access);
          }
        },
        modal: { ondismiss: () => updateUi(State.get("access")) },
      });
      checkout.on("payment.failed", () => updateUi(State.get("access")));
      checkout.open();
    } catch (error) {
      alert(`Unable to start payment: ${error.message}`);
      updateUi(State.get("access"));
    }
  }

  function wire() {
    const button = DOM.get("btn-get-premium");
    if (button && !button.dataset.listenerAdded) {
      button.dataset.listenerAdded = "true";
      button.addEventListener("click", startCheckout);
    }
    const applyButton = DOM.get("btn-apply-referral");
    if (applyButton && !applyButton.dataset.listenerAdded) {
      applyButton.dataset.listenerAdded = "true";
      applyButton.addEventListener("click", async () => {
        try { await validateReferral(); } catch (error) { alert(error.message); }
      });
    }
  }

  return { updateUi, renderPreviewCta, wire };
})();

/* ============================================================
   MODULE: DOM Helpers
   ============================================================ */
const DOM = (() => {
  const _cache = {};

  function get(id) {
    if (!_cache[id]) _cache[id] = document.getElementById(id);
    return _cache[id];
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function highlight(text, query) {
    if (!query || !query.trim()) return escHtml(text);
    const re = new RegExp(
      `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
      "gi",
    );
    return escHtml(text).replace(re, '<mark class="q-highlight">$1</mark>');
  }

  function typeClass(type) {
    const map = { LAQ: "laq", SAQ: "saq", VSQ: "vsq", CASE: "case" };
    return map[type?.toUpperCase()] || "default";
  }

  /**
   * buildChipGroup — renders a chip group inside a container element.
   * @param {HTMLElement} container
   * @param {Array}       values       — all available values
   * @param {Set}         activeSet    — currently selected values
   * @param {Function}    labelFn      — optional value → display label
   */
  function buildChipGroup(container, values, activeSet, labelFn) {
    container.innerHTML = "";
    values.forEach((v) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "type-chip" + (activeSet.has(v) ? " active" : "");
      btn.textContent = labelFn ? labelFn(v) : v;
      btn.dataset.value = String(v);
      btn.setAttribute("aria-pressed", activeSet.has(v) ? "true" : "false");
      container.appendChild(btn);
    });
  }

  // Rebuild marks <select> (single-select, unchanged)
  function rebuildSelect(selectEl, values, allLabel, isNumeric = false) {
    const current = selectEl.value;
    selectEl.innerHTML = `<option value="">${allLabel}</option>`;
    values.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = isNumeric ? String(v) : v;
      opt.textContent = isNumeric ? `${v}m` : v;
      selectEl.appendChild(opt);
    });
    if (current && [...selectEl.options].some((o) => o.value === current)) {
      selectEl.value = current;
    }
  }

  return { get, escHtml, highlight, typeClass, buildChipGroup, rebuildSelect };
})();

/* ============================================================
   MODULE: Renderer
   ============================================================ */
const Renderer = (() => {
  function renderCards(questions, searchQuery) {
    const list = DOM.get("questions-list");
    const empty = DOM.get("empty-state");
    const meta = DOM.get("results-meta");

    if (questions.length === 0) {
      list.innerHTML = "";
      empty.hidden = false;
      meta.innerHTML = "";
      return;
    }

    empty.hidden = true;

    const frag = document.createDocumentFragment();
    questions.forEach((q) => {
      const article = document.createElement("article");
      article.className = "q-card";
      article.setAttribute("role", "listitem");
      article.innerHTML = buildCardHTML(q, searchQuery);
      frag.appendChild(article);
    });

    list.innerHTML = "";
    list.appendChild(frag);

    const total = State.get("totalQuestions");
    const access = State.get("access");
    const previewMessage = access.isPremium
      ? ""
      : ` · Preview mode: unlock Premium to view more than ${access.previewLimit} questions`;
    meta.innerHTML = `Showing <strong>${questions.length}</strong> of <strong>${total}</strong> questions${previewMessage}`;
  }

  function buildCardHTML(q, searchQuery) {
    const typeKey = DOM.typeClass(q.type);
    const examLabel = q.exam ? DOM.escHtml(q.exam) : "";
    const partLabel = q.part ? `Part ${q.part}` : "";
    const titleStr = `${DOM.escHtml(q.subject)} (${q.year}) — ${q.marks}m ${DOM.escHtml(q.type)}${partLabel ? " · " + partLabel : ""}`;

    return `
      <div class="q-card-header">
        <span class="q-card-title">${titleStr}</span>
        <div class="q-card-meta-pills">
          <span class="pill-marks">${q.marks}m</span>
          <span class="pill-type pill-type--${typeKey}">${DOM.escHtml(q.type)}</span>
        </div>
      </div>
      <p class="q-card-question">${DOM.highlight(q.question, searchQuery.toLowerCase())}</p>
      <div class="q-card-footer">
        <span class="tag">
          ${DOM.escHtml(q.topic)}
          <span class="tag-arrow">→</span>
          ${DOM.escHtml(q.subtopic)}
        </span>
        ${examLabel ? `<span class="tag tag-exam">${examLabel}</span>` : ""}
        <span class="tag tag-college">${DOM.escHtml(q.college)}</span>
      </div>
    `;
  }

  /** Rebuild all filter chip groups + marks select (cascade-aware) */
  function renderFilterDropdowns() {
    const filters = State.get("filters");
    const options = State.get("filterOptions");

    // Filter options are returned by the protected server endpoint. They must
    // not be derived from hidden question rows in the browser.
    DOM.buildChipGroup(DOM.get("filter-year"), options.years, filters.years, (v) =>
      String(v),
    );

    DOM.buildChipGroup(DOM.get("filter-topic"), options.topics, filters.topics);

    DOM.buildChipGroup(
      DOM.get("filter-subtopic"),
      options.subtopics,
      filters.subtopics,
    );

    DOM.buildChipGroup(DOM.get("filter-exam"), options.exams, filters.exams);

    // Dim subtopic group if no topic selected
    const subWrap = DOM.get("filter-subtopic");
    subWrap.style.opacity = filters.topics.size === 0 ? "0.45" : "1";
    subWrap.style.pointerEvents = filters.topics.size === 0 ? "none" : "";

    // --- MARKS (single <select>, cascade after years+topics+subtopics) ---
    DOM.rebuildSelect(DOM.get("filter-marks"), options.marks, "All Marks", true);
    DOM.get("filter-marks").value = filters.marks;
  }

  /** Render type chips (static after load) */
  function renderTypeChips(allTypes) {
    DOM.buildChipGroup(
      DOM.get("filter-type"),
      allTypes,
      State.getFilter("types"),
    );
  }

  /** Active filter badge count on the Filters button */
  function renderFilterBadge() {
    const f = State.get("filters");
    const s = State.get("searchQuery");
    let count =
      f.years.size +
      f.topics.size +
      f.subtopics.size +
      f.exams.size +
      f.types.size +
      (f.marks ? 1 : 0) +
      (s.trim() ? 1 : 0);

    const badge = DOM.get("filter-badge");
    if (count > 0) {
      badge.textContent = count;
      badge.classList.add("visible");
    } else {
      badge.classList.remove("visible");
      badge.textContent = "";
    }
  }

  return {
    renderCards,
    renderFilterDropdowns,
    renderTypeChips,
    renderFilterBadge,
  };
})();

/* ============================================================
   MODULE: Event Handlers
   ============================================================ */
const Events = (() => {
  let _allTypes = [];

  function wireAll() {
    // ── Filter panel toggle ──
    DOM.get("btn-toggle-filters").addEventListener("click", () => {
      const panel = DOM.get("filter-panel");
      const btn = DOM.get("btn-toggle-filters");
      const isOpen = panel.classList.toggle("open");
      btn.setAttribute("aria-expanded", String(isOpen));
      panel.setAttribute("aria-hidden", String(!isOpen));
    });

    // ── YEAR chips (event delegation) ──
    DOM.get("filter-year").addEventListener("click", (e) => {
      const chip = e.target.closest(".type-chip");
      if (!chip) return;
      const val = Number(chip.dataset.value);
      State.toggleSetFilter("years", val);
      // Cascade: reset topics + subtopics when year selection changes
      State.setSetFilter("topics", []);
      State.setSetFilter("subtopics", []);
      applyAndRender();
    });

    // ── TOPIC chips ──
    DOM.get("filter-topic").addEventListener("click", (e) => {
      const chip = e.target.closest(".type-chip");
      if (!chip) return;
      State.toggleSetFilter("topics", chip.dataset.value);
      // Cascade: reset subtopics when topic changes
      State.setSetFilter("subtopics", []);
      applyAndRender();
    });

    // ── SUBTOPIC chips ──
    DOM.get("filter-subtopic").addEventListener("click", (e) => {
      const chip = e.target.closest(".type-chip");
      if (!chip) return;
      State.toggleSetFilter("subtopics", chip.dataset.value);
      applyAndRender();
    });

    // ── EXAM chips ──
    DOM.get("filter-exam").addEventListener("click", (e) => {
      const chip = e.target.closest(".type-chip");
      if (!chip) return;
      State.toggleSetFilter("exams", chip.dataset.value);
      applyAndRender();
    });

    // ── MARKS select ──
    DOM.get("filter-marks").addEventListener("change", (e) => {
      State.setFilter("marks", e.target.value);
      applyAndRender();
    });

    // ── TYPE chips ──
    DOM.get("filter-type").addEventListener("click", (e) => {
      const chip = e.target.closest(".type-chip");
      if (!chip) return;
      State.toggleSetFilter("types", chip.dataset.value);
      Renderer.renderTypeChips(_allTypes);
      applyAndRender();
    });

    // ── Last 5 / Last 10 years ──
    DOM.get("btn-last5").addEventListener("click", () => {
      const top5 = State.get("filterOptions").years.slice(0, 5);
      State.setSetFilter("years", top5);
      State.setSetFilter("topics", []);
      State.setSetFilter("subtopics", []);
      applyAndRender();
    });

    DOM.get("btn-last10").addEventListener("click", () => {
      const top10 = State.get("filterOptions").years.slice(0, 10);
      State.setSetFilter("years", top10);
      State.setSetFilter("topics", []);
      State.setSetFilter("subtopics", []);
      applyAndRender();
    });

    // ── Sort ──
    DOM.get("sort-by").addEventListener("change", (e) => {
      State.setSort("by", e.target.value);
      applyAndRender();
    });
    DOM.get("sort-order").addEventListener("change", (e) => {
      State.setSort("order", e.target.value);
      applyAndRender();
    });

    // ── Search (debounced) ──
    DOM.get("search-input").addEventListener(
      "input",
      debounce((e) => {
        State.set("searchQuery", e.target.value);
        DOM.get("search-clear").hidden = !e.target.value;
        applyAndRender();
      }, 200),
    );

    DOM.get("search-clear").addEventListener("click", () => {
      DOM.get("search-input").value = "";
      State.set("searchQuery", "");
      DOM.get("search-clear").hidden = true;
      applyAndRender();
    });

    // ── Reset ──
    const doReset = () => {
      State.resetFilters();
      DOM.get("search-input").value = "";
      DOM.get("search-clear").hidden = true;
      DOM.get("sort-by").value = "year";
      DOM.get("sort-order").value = "desc";
      State.setSort("by", "year");
      State.setSort("order", "desc");
      Renderer.renderTypeChips(_allTypes);
      applyAndRender();
    };
    DOM.get("btn-reset-filters").addEventListener("click", doReset);
    DOM.get("btn-reset-empty").addEventListener("click", doReset);

    // ── Export button → shows modal with PDF / CSV choice ──
    DOM.get("btn-export").addEventListener("click", () => {
      DOM.get("export-modal").classList.add("open");
    });
    DOM.get("modal-close").addEventListener("click", () => {
      DOM.get("export-modal").classList.remove("open");
    });
    DOM.get("export-modal").addEventListener("click", (e) => {
      if (e.target === DOM.get("export-modal"))
        DOM.get("export-modal").classList.remove("open");
    });

    DOM.get("btn-export-pdf").addEventListener("click", () => {
      DOM.get("export-modal").classList.remove("open");
      triggerPDFExport();
    });
    DOM.get("btn-export-csv").addEventListener("click", () => {
      DOM.get("export-modal").classList.remove("open");
      triggerCSVExport();
    });
  }

  function setAllTypes(types) {
    _allTypes = types;
  }

  return { wireAll, setAllTypes };
})();

/* ============================================================
   UTILITY
   ============================================================ */
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

async function triggerPDFExport() {
  const exportButton = DOM.get("btn-export");
  const pdfButton = DOM.get("btn-export-pdf");
  const originalLabel = pdfButton.querySelector("strong")?.textContent || "Export as PDF";

  try {
    exportButton.disabled = true;
    pdfButton.disabled = true;
    const label = pdfButton.querySelector("strong");
    if (label) label.textContent = "Generating secure PDF…";

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.access_token) throw new Error("Please sign in to export questions");

    // Only filter criteria leave the browser. The Edge Function independently
    // retrieves the questions, validates Premium/device access, and reserves
    // a daily quota slot before generating the document.
    const request = buildQuestionRequest({ includeOptions: false });
    delete request.page;
    delete request.pageSize;
    const response = await fetch(`${SUPABASE_URL}/functions/v1/export-questions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        "x-repomed-device": DeviceIdentity.token(),
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      let message = "Unable to generate the PDF";
      try {
        const payload = await response.json();
        if (typeof payload?.error === "string") message = payload.error;
      } catch (_) {
        // Keep the safe fallback for a malformed error response.
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    if (!blob.size) throw new Error("The generated PDF was empty");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${State.get("subject").replace(/[^A-Za-z0-9_-]/g, "_")}_PYQs_RepoMed.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Secure PDF export failed:", error);
    alert(error instanceof Error ? error.message : "Unable to generate the PDF");
  } finally {
    exportButton.disabled = !State.get("access")?.isPremium;
    pdfButton.disabled = false;
    const label = pdfButton.querySelector("strong");
    if (label) label.textContent = originalLabel;
  }
}

function triggerCSVExport() {
  // A client-side CSV would evade the server's entitlement and quota checks.
  alert("CSV export is not available. Use the secure PDF export instead.");
}

/* ============================================================
   CORE: applyAndRender
   ============================================================ */
let latestRequest = 0;
async function applyAndRender() {
  const requestId = ++latestRequest;
  const response = await DataLoader.loadData({ page: 0, pageSize: 250, includeOptions: true });
  if (requestId !== latestRequest) return;

  State.set("allQuestions", response.questions);
  State.set("totalQuestions", response.total);
  State.set("pagination", { page: response.page ?? 0, limit: response.limit ?? 250, hasMore: response.hasMore === true });
  if (response.options) State.set("filterOptions", response.options);
  State.set("access", response.access);

  // Questions remain paginated at the Edge Function, but premium users should
  // finish with every row matching their current filter—not merely page one.
  if (response.access?.isPremium && response.hasMore) {
    DOM.get("results-meta").textContent = "Loading all matching questions…";
    await loadRemainingPremiumPages(requestId);
    if (requestId !== latestRequest) return;
  }

  PremiumPayment.updateUi(response.access);
  PremiumPayment.renderPreviewCta(response.access);
  const exportButton = DOM.get("btn-export");
  exportButton.disabled = !response.access.isPremium;
  exportButton.title = response.access.isPremium
    ? "Export the current filtered results"
    : "Premium access is required to export questions";
  Renderer.renderCards(State.get("allQuestions"), State.get("searchQuery"));
  Renderer.renderFilterDropdowns();
  Renderer.renderFilterBadge();
}

async function loadRemainingPremiumPages(requestId) {
  while (requestId === latestRequest && State.get("pagination").hasMore) {
    const paging = State.get("pagination");
    const response = await DataLoader.loadData({
      page: paging.page + 1,
      pageSize: paging.limit,
      includeOptions: false,
    });
    if (requestId !== latestRequest) return;
    if (!response.access?.isPremium) throw new Error("Premium access is required to load more questions");

    const existing = State.get("allQuestions");
    const existingIds = new Set(existing.map((question) => question.id));
    State.set("allQuestions", [...existing, ...response.questions.filter((question) => !existingIds.has(question.id))]);
    State.set("totalQuestions", response.total);
    State.set("pagination", { page: response.page, limit: response.limit, hasMore: response.hasMore === true });
  }
}

/* ============================================================
   AUTH UI MANAGEMENT (for subject page)
   ============================================================ */
async function updateAuthUI() {
  try {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    const signInBtn = document.getElementById("sign-in-btn");
    const userMenu = document.getElementById("user-menu");
    const userEmail = document.getElementById("user-email");
    const logoutBtn = document.getElementById("logout-btn");

    if (!signInBtn || !userMenu) return;

    if (session && session.user) {
      // User is logged in
      signInBtn.style.display = "none";
      userMenu.classList.remove("hidden");
      userEmail.textContent = session.user.email || "Account";
      await updateEntitlementBadge(session);

      // Set up logout handler
      if (logoutBtn && !logoutBtn.dataset.listenerAdded) {
        logoutBtn.dataset.listenerAdded = "true";
        logoutBtn.addEventListener("click", async () => {
          try {
            logoutBtn.disabled = true;
            logoutBtn.textContent = "Signing out...";

            const { error } = await supabaseClient.auth.signOut();

            if (error) {
              alert("Error signing out: " + error.message);
              return;
            }

            // Update UI
            signInBtn.style.display = "block";
            userMenu.classList.add("hidden");
            signInBtn.textContent = "Sign In";

            alert("Signed out successfully!");
          } catch (error) {
            alert("Error: " + error.message);
          } finally {
            logoutBtn.disabled = false;
            logoutBtn.textContent = "Sign Out";
          }
        });
      }
    } else {
      // User is not logged in
      signInBtn.style.display = "block";
      userMenu.classList.add("hidden");
      const accessBadge = document.getElementById("access-badge");
      if (accessBadge) accessBadge.hidden = true;
    }
  } catch (error) {
    console.error("Error updating auth UI:", error);
  }
}

async function updateEntitlementBadge(session) {
  const badge = document.getElementById("access-badge");
  if (!badge || !session?.access_token) return;
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/get-my-entitlements`, {
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY },
    });
    const payload = await response.json();
    const entitlements = payload?.entitlements || [];
    if (!entitlements.length) { badge.hidden = true; return; }
    const gold = entitlements.find((entry) => entry.products?.code === "GOLD");
    badge.hidden = false;
    badge.textContent = gold ? "GOLD" : `${entitlements.length} Plan${entitlements.length > 1 ? "s" : ""}`;
    badge.title = entitlements.map((entry) => `${entry.products?.code || "Plan"}: valid until ${new Date(entry.expires_at).toLocaleDateString("en-IN")}`).join("\n");
    badge.style.color = gold ? "#9a6700" : "";
  } catch (error) {
    console.warn("Unable to load entitlement badge", error);
    badge.hidden = true;
  }
}

/* ============================================================
   BOOT
   ============================================================ */
async function init() {
  const params = new URLSearchParams(window.location.search);
  const subject = params.get("name") || "Anatomy";
  State.set("subject", subject);

  document.title = `${subject} – RepoMed PYQs`;
  DOM.get("subject-title").textContent = subject;

  DOM.get("loading-state").hidden = false;
  DOM.get("questions-list").innerHTML = "";
  DOM.get("empty-state").hidden = true;

  // Check and update authentication status UI
  await updateAuthUI();

  // Listen for auth state changes
  if (typeof supabaseClient !== "undefined") {
    supabaseClient.auth.onAuthStateChange((event, session) => {
      updateAuthUI();
    });
  }

  try {
    await applyAndRender();

    const allTypes = State.get("filterOptions").types;
    Events.setAllTypes(allTypes);
    Renderer.renderTypeChips(allTypes);

    Events.wireAll();
    PremiumPayment.wire();

    DOM.get("loading-state").hidden = true;
  } catch (err) {
    DOM.get("loading-state").hidden = true;
    const message = await getFunctionErrorMessage(err, "Failed to load questions. Please refresh the page.");
    DOM.get("questions-list").innerHTML =
      `<p style="color:#ef4444;padding:32px 0;text-align:center">
        ${DOM.escHtml(message)}
       </p>`;
    console.error("[RepoMed] Data load error:", { message, error: err });
  }
}

document.addEventListener("DOMContentLoaded", init);

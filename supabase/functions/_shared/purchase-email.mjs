const RESEND_URL = "https://api.resend.com/emails";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[character]));
}

function formatMoney(paise) {
  const value = Number(paise);
  const absolute = Math.abs(Number.isFinite(value) ? Math.trunc(value) : 0);
  const prefix = value < 0 ? "−" : "";
  return `${prefix}₹${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "long", year: "numeric",
  }).format(new Date(value));
}

function emailHtml(context) {
  const subjects = context.product.all_access
    ? "Access to all RepoMed subjects"
    : context.subjects.map((subject) => `• ${escapeHtml(subject)}`).join("<br>");
  const discount = context.discountAmount > 0
    ? `<tr><td style="padding:6px 0;color:#64748b">Referral${context.referralCode ? ` (${escapeHtml(context.referralCode)})` : ""}</td><td style="padding:6px 0;text-align:right">−${formatMoney(context.discountAmount)}</td></tr>`
    : "";
  const reference = context.paymentReference
    ? `<tr><td style="padding:6px 0;color:#64748b">Payment ID</td><td style="padding:6px 0;text-align:right">${escapeHtml(context.paymentReference)}</td></tr>`
    : `<tr><td style="padding:6px 0;color:#64748b">Payment method</td><td style="padding:6px 0;text-align:right">Promotional / Referral</td></tr>`;
  const greeting = context.customerName ? `Hi ${escapeHtml(context.customerName)},` : "Hello,";
  return `<!doctype html><html><body style="margin:0;background:#f5f3ff;font-family:Arial,sans-serif;color:#172033">
  <div style="max-width:620px;margin:0 auto;padding:28px 16px"><div style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e9e5ff">
  <div style="background:linear-gradient(120deg,#302b8f,#9554d8);padding:26px 30px;color:#fff"><strong style="font-size:24px">RepoMed</strong><div style="margin-top:8px;font-size:15px;opacity:.9">Your purchase is confirmed</div></div>
  <div style="padding:30px"><p style="font-size:16px">${greeting}</p><p style="line-height:1.6">Your RepoMed access has been successfully activated.</p>
  <h2 style="font-size:16px;color:#5b4cf5;margin:28px 0 9px">PLAN</h2><p style="margin:0;font-size:20px;font-weight:bold">${escapeHtml(context.product.name)}</p><p style="color:#64748b;margin:7px 0">${escapeHtml(context.product.academic_year)}</p><p style="line-height:1.7;margin:14px 0">${subjects}</p>
  <h2 style="font-size:16px;color:#5b4cf5;margin:28px 0 9px">PURCHASE DETAILS</h2><table style="width:100%;border-collapse:collapse;font-size:14px"><tr><td style="padding:6px 0;color:#64748b">Original price</td><td style="padding:6px 0;text-align:right">${formatMoney(context.originalAmount)}</td></tr>${discount}<tr><td style="padding:8px 0;font-weight:bold">Amount paid</td><td style="padding:8px 0;text-align:right;font-weight:bold">${formatMoney(context.finalAmount)}</td></tr>${reference}<tr><td style="padding:6px 0;color:#64748b">Purchase date</td><td style="padding:6px 0;text-align:right">${formatDate(context.purchaseDate)}</td></tr></table>
  <h2 style="font-size:16px;color:#5b4cf5;margin:28px 0 9px">ACCESS</h2><table style="width:100%;border-collapse:collapse;font-size:14px"><tr><td style="padding:6px 0;color:#64748b">Activated</td><td style="padding:6px 0;text-align:right">${formatDate(context.startsAt)}</td></tr><tr><td style="padding:6px 0;color:#64748b">Valid until</td><td style="padding:6px 0;text-align:right">${formatDate(context.expiresAt)}</td></tr></table>
  <p style="text-align:center;margin:30px 0 8px"><a href="${escapeHtml(context.baseUrl)}" style="display:inline-block;background:#5b4cf5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">Open RepoMed</a></p>
  </div><div style="padding:18px 30px;color:#64748b;font-size:12px;background:#fbfaff">RepoMed · A Medical PYQ Repository<br>This is an automated transactional email regarding your RepoMed purchase.</div></div></div></body></html>`;
}

async function markEmail(admin, id, values) {
  const { error } = await admin.from("purchase_emails").update(values).eq("id", id);
  if (error) console.error("Unable to update purchase email audit", { emailId: id, message: error.message });
}

async function getContext(admin, input) {
  let userId, productId, paymentId = null, paymentOrderId = null, referralRedemptionId = null;
  let originalAmount, discountAmount, finalAmount, referralCode = null, paymentReference = null, purchaseDate;
  if (input.razorpayPaymentId) {
    const { data: payment, error } = await admin.from("payments")
      .select("id,user_id,payment_order_id,razorpay_payment_id,verified_at")
      .eq("razorpay_payment_id", input.razorpayPaymentId).maybeSingle();
    if (error || !payment) throw new Error("Payment email context is unavailable");
    const { data: order, error: orderError } = await admin.from("payment_orders")
      .select("id,user_id,product_id,original_amount_paise,discount_amount_paise,amount_paise,referral_code,paid_at")
      .eq("id", payment.payment_order_id).maybeSingle();
    if (orderError || !order) throw new Error("Payment order email context is unavailable");
    ({ user_id: userId, product_id: productId } = order);
    paymentId = payment.id; paymentOrderId = order.id;
    originalAmount = order.original_amount_paise; discountAmount = order.discount_amount_paise; finalAmount = order.amount_paise;
    referralCode = order.referral_code; paymentReference = payment.razorpay_payment_id; purchaseDate = order.paid_at || payment.verified_at;
  } else if (input.referralRedemptionId) {
    const { data: redemption, error } = await admin.from("referral_redemptions")
      .select("id,user_id,product_id,original_amount_paise,discount_amount_paise,final_amount_paise,redeemed_at,referral_codes(code)")
      .eq("id", input.referralRedemptionId).maybeSingle();
    if (error || !redemption) throw new Error("Referral email context is unavailable");
    ({ user_id: userId, product_id: productId } = redemption);
    referralRedemptionId = redemption.id; originalAmount = redemption.original_amount_paise; discountAmount = redemption.discount_amount_paise;
    finalAmount = redemption.final_amount_paise; referralCode = redemption.referral_codes?.code || null; purchaseDate = redemption.redeemed_at;
  } else throw new Error("Purchase email event is invalid");

  const [{ data: product, error: productError }, { data: entitlement, error: entitlementError }, { data: profile }] = await Promise.all([
    admin.from("products").select("id,name,academic_year,all_access,product_subjects(subject_key)").eq("id", productId).maybeSingle(),
    admin.from("user_entitlements").select("starts_at,expires_at").eq("user_id", userId).eq("product_id", productId).maybeSingle(),
    admin.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);
  if (productError || entitlementError || !product || !entitlement) throw new Error("Entitlement email context is unavailable");
  const { data: auth } = await admin.auth.admin.getUserById(userId);
  const email = auth?.user?.email;
  if (!email) throw new Error("Purchaser email is unavailable");
  return { userId, email, customerName: profile?.full_name || auth.user.user_metadata?.full_name || "", product, subjects: product.product_subjects?.map((row) => row.subject_key) || [], entitlement, paymentId, paymentOrderId, referralRedemptionId, originalAmount, discountAmount, finalAmount, referralCode, paymentReference, purchaseDate };
}

export async function sendPurchaseConfirmation(admin, input) {
  try {
    const context = await getContext(admin, input);
    const eventKey = input.razorpayPaymentId ? `razorpay-payment:${input.razorpayPaymentId}` : `free-referral:${context.referralRedemptionId}`;
    const { data: claim, error: claimError } = await admin.rpc("claim_purchase_email", {
      p_event_key: eventKey, p_user_id: context.userId, p_recipient_email: context.email,
      p_payment_id: context.paymentId, p_payment_order_id: context.paymentOrderId, p_referral_redemption_id: context.referralRedemptionId,
    });
    if (claimError || !claim?.[0]?.should_send) return { sent: false, skipped: true };
    const emailId = claim[0].email_id;
    const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const fromEmail = Deno.env.get("REPOMED_FROM_EMAIL") ?? "";
    const fromName = Deno.env.get("REPOMED_FROM_NAME") ?? "RepoMed";
    if (!apiKey || !fromEmail) {
      await markEmail(admin, emailId, { status: "failed", error_message: "Transactional email sender is not configured" });
      return { sent: false, skipped: false };
    }
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Resend also deduplicates an uncertain network retry for this event.
        "Idempotency-Key": eventKey,
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [context.email],
        subject: `RepoMed purchase confirmed — ${context.product.name}`,
        html: emailHtml({
          ...context,
          startsAt: context.entitlement.starts_at,
          expiresAt: context.entitlement.expires_at,
          baseUrl: Deno.env.get("REPOMED_BASE_URL") || "https://repomed.in",
        }),
      }),
    });
    const provider = await response.json().catch(() => ({}));
    if (!response.ok || !provider?.id) {
      await markEmail(admin, emailId, { status: "failed", error_message: "Email provider rejected the delivery request" });
      console.warn("Purchase email delivery failed", { eventKey, status: response.status });
      return { sent: false, skipped: false };
    }
    await markEmail(admin, emailId, { status: "sent", provider_message_id: provider.id, sent_at: new Date().toISOString(), error_message: null });
    return { sent: true, skipped: false };
  } catch (error) {
    // This helper is deliberately non-throwing: an email failure must never
    // invalidate an already captured payment or an active entitlement.
    console.error("Purchase email processing failed", { message: error instanceof Error ? error.message : "unknown error" });
    return { sent: false, skipped: false };
  }
}

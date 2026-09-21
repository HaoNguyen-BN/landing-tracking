/* ============================================================
   TRACK-CORE.JS — Bắt _fbp/_fbc, tạo Email ảo, chuẩn hóa SĐT,
   đẩy dữ liệu đơn hàng sang Poscake (kèm tracking blob trong note)
   Yêu cầu: window.LANDING_CONFIG phải được khai báo TRƯỚC script này.
   ============================================================ */
(function () {
  "use strict";
  var CFG = window.LANDING_CONFIG || {};
  if (!CFG.WEBHOOK_URL) { console.warn("[TRACK] Thiếu LANDING_CONFIG.WEBHOOK_URL"); return; }

  // ---------- Helpers ----------
  function getCookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  function getQueryParam(name) {
    var m = new RegExp("[?&]" + name + "=([^&]*)").exec(window.location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
  }

  function uuidv4() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getFbp() { return getCookie("_fbp"); }

  function getFbc() {
    var fbc = getCookie("_fbc");
    if (fbc) return fbc;
    var fbclid = getQueryParam("fbclid");
    if (fbclid) return "fb.1." + Date.now() + "." + fbclid;
    return "";
  }

  // Chuẩn hoá SĐT theo mã vùng quốc gia: bỏ số 0 đầu, gắn mã vùng nếu thiếu
  function normalizePhone(rawPhone, callingCode) {
    var digits = String(rawPhone || "").replace(/\D/g, "");
    if (!digits) return "";
    if (digits.indexOf(callingCode) === 0) {
      // đã có mã vùng rồi, giữ nguyên
    } else if (digits.charAt(0) === "0") {
      digits = callingCode + digits.substring(1);
    } else {
      digits = callingCode + digits;
    }
    return digits;
  }

  function buildVirtualEmail(normalizedPhone) {
    return normalizedPhone + "@gmail.com";
  }

  // Dò field theo nhiều pattern tên/id/placeholder (vì mỗi form LadiPage đặt tên khác nhau)
  function findFieldValue(form, patterns) {
    var inputs = form.querySelectorAll("input, select, textarea");
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var key = ((el.name || "") + " " + (el.id || "") + " " + (el.getAttribute("placeholder") || "")).toLowerCase();
      for (var j = 0; j < patterns.length; j++) {
        if (key.indexOf(patterns[j]) !== -1) return (el.value || "").trim();
      }
    }
    return "";
  }

  function pickProduct(form) {
    var selected = form.querySelector("input[type=radio]:checked, input[type=checkbox]:checked, select");
    var key = selected ? (selected.value || selected.getAttribute("data-option") || "") : "";
    var product = (CFG.PRODUCTS && (CFG.PRODUCTS[key] || CFG.PRODUCTS.option_1)) || {};
    return product;
  }

  function sendToWebhook(payload) {
    var headers = { "Content-Type": "application/json" };
    if (CFG.WEBHOOK_AUTH && CFG.WEBHOOK_AUTH.username) {
      headers["Authorization"] = "Basic " + btoa(CFG.WEBHOOK_AUTH.username + ":" + CFG.WEBHOOK_AUTH.password);
    }
    try {
      fetch(CFG.WEBHOOK_URL, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function (err) { console.warn("[TRACK] fetch lỗi", err); });
    } catch (e) { console.warn("[TRACK] send lỗi", e); }
  }

  function handleFormSubmit(form) {
    var rawPhone = findFieldValue(form, ["phone", "sdt", "dienthoai", "dien_thoai", "tel"]);
    var name = findFieldValue(form, ["name", "hoten", "ho_ten", "fullname"]);
    if (!rawPhone) return; // không bắt được SĐT thì bỏ qua, không đẩy rác

    var phone = normalizePhone(rawPhone, CFG.COUNTRY_CALLING_CODE);
    var email = buildVirtualEmail(phone);
    var externalId = uuidv4();
    var product = pickProduct(form);

    // Blob tracking sẽ được nhét vào field "note" khi tạo đơn trên Poscake,
    // để khi Poscake bắn Webhook đổi trạng thái, GAS lấy lại được nguyên vẹn.
    var trackingBlob = {
      external_id: externalId,
      fbp: getFbp(),
      fbc: getFbc(),
      email: email,
      phone: phone,
      currency: CFG.CURRENCY,
      value: product.price || 0,
      content_id: product.content_id || "",
      sku: product.sku || "",
      user_agent: navigator.userAgent,
      source_url: window.location.href
    };

    var payload = {
      customer_name: name,
      phone: phone,
      product_name: product.name || "",
      sku: product.sku || "",
      quantity: product.quantity || 1,
      price: product.price || 0,
      content_id: product.content_id || "",
      currency: CFG.CURRENCY,
      note: "TRACKING::" + JSON.stringify(trackingBlob)
    };

    sendToWebhook(payload);

    try { sessionStorage.setItem("track_last_external_id", externalId); } catch (e) {}
  }

  // Bắt mọi submit form trên trang, không preventDefault để không phá luồng gốc của LadiPage
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (form && form.tagName === "FORM") handleFormSubmit(form);
  }, true);

  console.log("[TRACK] Loaded – mã vùng " + CFG.COUNTRY_CALLING_CODE + " / " + CFG.CURRENCY);
})();

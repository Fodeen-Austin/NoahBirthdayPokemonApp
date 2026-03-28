/**
 * Curious Comics landing — copy in ../data/comic-signup.json.
 * Signups: InstantDB entity `comic_signups` (same appId as data/config.json).
 * Forms submit only on button click (no per-keystroke writes).
 */

import { init, id } from "https://esm.sh/@instantdb/core";
import { INSTANT_SCHEMA } from "./instant-schema.js";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let signupDb = null;

function getSignupDb(appId) {
  if (!appId || typeof appId !== "string") return null;
  if (!signupDb) {
    signupDb = init({ appId, schema: INSTANT_SCHEMA, verbose: false });
  }
  return signupDb;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text ?? "";
}

function setParagraphs(containerId, paragraphs) {
  const el = document.getElementById(containerId);
  if (!el || !Array.isArray(paragraphs)) return;
  el.innerHTML = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
}

function wireImage(imgId, wrapSelector, url, alt) {
  const img = document.getElementById(imgId);
  const wrap = img?.closest(wrapSelector);
  if (!img) return;
  const hasUrl = Boolean(url && String(url).trim());
  if (hasUrl) {
    const path = String(url).replace(/^\.\//, "");
    img.src = new URL(path, window.location.href).href;
    img.alt = alt || "";
    if (wrap) wrap.classList.remove("is-empty");
  } else {
    img.removeAttribute("src");
    if (wrap) wrap.classList.add("is-empty");
  }
  const fallback = wrap?.querySelector?.(".comics-product-fallback");
  if (fallback) fallback.hidden = hasUrl;
}

function applyFormCopy(prefix, block) {
  if (!block) return;
  setText(`${prefix}-headline`, block.headline);
  setText(`${prefix}-lead`, block.description);
  setText(`${prefix}-label-child`, block.childNameLabel);
  setText(`${prefix}-label-email`, block.emailLabel);
  const childInput = document.getElementById(`${prefix}-child`);
  const emailInput = document.getElementById(`${prefix}-email`);
  const btn = document.getElementById(`${prefix}-submit`);
  if (childInput) {
    childInput.placeholder = block.childPlaceholder || "";
    childInput.autocomplete = "given-name";
  }
  if (emailInput) {
    emailInput.placeholder = block.emailPlaceholder || "";
    emailInput.autocomplete = "email";
  }
  if (btn) btn.textContent = block.buttonText || "JOIN NOW!";
  setText(`${prefix}-disclaimer`, block.disclaimer);
}

function showFormStatus(formEl, type, message) {
  const status = formEl.querySelector(".comics-form-status");
  if (!status) return;
  status.textContent = message;
  status.classList.add("is-visible", type === "ok" ? "is-ok" : "is-err");
  status.classList.remove(type === "ok" ? "is-err" : "is-ok");
}

function hideFormStatus(formEl) {
  const status = formEl.querySelector(".comics-form-status");
  if (!status) return;
  status.classList.remove("is-visible", "is-ok", "is-err");
  status.textContent = "";
}

function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());
}

async function postToExternalEndpoint(endpoint, method, form, childName, email) {
  const body = new FormData(form);
  body.set("childFirstName", childName);
  body.set("parentEmail", email);
  body.append("_subject", "Curious Comics signup");
  const res = await fetch(endpoint, {
    method,
    body,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function handleComicFormSubmit(event, comicConfig, appConfig) {
  event.preventDefault();
  const form = event.target;
  hideFormStatus(form);
  const fd = new FormData(form);
  const childName = String(fd.get("childFirstName") || "").trim();
  const email = String(fd.get("parentEmail") || "").trim();
  if (!childName) {
    showFormStatus(form, "err", "Please enter your child's first name.");
    return;
  }
  if (!validEmail(email)) {
    showFormStatus(form, "err", "Please enter a valid parent email.");
    return;
  }

  const appId = appConfig?.instantAppId;
  const endpoint = (comicConfig.formSubmit && comicConfig.formSubmit.endpoint) || "";
  const method = (comicConfig.formSubmit && comicConfig.formSubmit.method) || "POST";
  const successMessage =
    (comicConfig.formSubmit && comicConfig.formSubmit.successMessage) || "Thanks — you're on the list!";
  const unavailableMessage =
    (comicConfig.formSubmit && comicConfig.formSubmit.unavailableMessage) ||
    "Something went wrong. Please try again in a moment.";

  const submitBtn = form.querySelector("button[type='submit']");
  if (submitBtn) submitBtn.disabled = true;

  try {
    if (appId) {
      const db = getSignupDb(appId);
      if (!db) throw new Error("InstantDB init failed");
      db.transact(
        db.tx.comic_signups[id()].create({
          childFirstName: childName,
          parentEmail: email,
          createdAt: Date.now(),
          formSource: form.id === "comics-form-primary" ? "primary" : "secondary",
        })
      );
      if (endpoint) {
        try {
          await postToExternalEndpoint(endpoint, method, form, childName, email);
        } catch (e) {
          console.warn("[Curious Comics] InstantDB saved; external endpoint failed:", e);
        }
      }
      showFormStatus(form, "ok", successMessage);
      form.reset();
    } else if (endpoint) {
      await postToExternalEndpoint(endpoint, method, form, childName, email);
      showFormStatus(form, "ok", successMessage);
      form.reset();
    } else {
      console.info("[Curious Comics] No instantAppId or endpoint — demo only:", { childName, email });
      if (comicConfig.formSubmit && comicConfig.formSubmit.demoLogNote) {
        console.info(comicConfig.formSubmit.demoLogNote);
      }
      showFormStatus(form, "ok", successMessage);
      form.reset();
    }
  } catch (e) {
    console.warn("Comic signup failed:", e);
    showFormStatus(form, "err", unavailableMessage);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function init() {
  const comicUrl = new URL("../data/comic-signup.json", import.meta.url).href;
  const configUrl = new URL("../data/config.json", import.meta.url).href;
  let config;
  let appConfig;
  try {
    const [comicRes, cfgRes] = await Promise.all([fetch(comicUrl), fetch(configUrl)]);
    if (!comicRes.ok) throw new Error(`comic-signup.json ${comicRes.status}`);
    if (!cfgRes.ok) throw new Error(`config.json ${cfgRes.status}`);
    config = await comicRes.json();
    appConfig = await cfgRes.json();
  } catch (e) {
    console.error("Failed to load page data", e);
    document.getElementById("comics-root").innerHTML = `
      <div class="comics-load-error">
        <h2>Could not load page content</h2>
        <p>Check that <code>data/comic-signup.json</code> and <code>data/config.json</code> are available and you are using a local server.</p>
      </div>
    `;
    return;
  }

  document.title = config.pageTitle || document.title;
  const meta = document.querySelector('meta[name="description"]');
  if (meta && config.metaDescription) meta.setAttribute("content", config.metaDescription);

  setText("comics-back-label", config.backLinkLabel || "← Back");

  const h = config.header || {};
  setText("comics-logo-l1", h.logoLine1);
  setText("comics-logo-l2", h.logoLine2);
  setText("comics-tagline", h.taglineBanner);
  wireImage("comics-header-hero-img", ".comics-hero-art", h.heroImage, h.heroImageAlt);

  const g = config.heroGrid || {};
  setText("comics-product-title", g.productCaption);
  setText("comics-product-sub", g.productSubcaption);
  wireImage("comics-product-img", ".comics-product-mock", g.productImage, g.productImageAlt);

  applyFormCopy("comics-p", config.formPrimary);
  applyFormCopy("comics-s", config.formSecondary);

  const mh = config.meetHero || {};
  setText("comics-meet-banner", mh.banner);
  setText("comics-meet-name", mh.name);
  setText("comics-meet-role", mh.roleLine);
  setParagraphs("comics-meet-bio", mh.bioParagraphs);
  wireImage("comics-meet-img", ".comics-panel-illu", mh.image, mh.imageAlt);

  const au = config.author || {};
  setText("comics-author-banner", au.banner);
  setText("comics-author-title", au.title);
  setParagraphs("comics-author-bio", au.bioParagraphs);
  wireImage("comics-author-img", ".comics-panel-illu", au.image, au.imageAlt);

  const f = config.footer || {};
  setText("comics-footer-line", f.line);
  setText("comics-footer-icon", f.icon || "");

  const formPrimary = document.getElementById("comics-form-primary");
  const formSecondary = document.getElementById("comics-form-secondary");
  if (formPrimary) {
    formPrimary.addEventListener("submit", (e) => handleComicFormSubmit(e, config, appConfig));
  }
  if (formSecondary) {
    formSecondary.addEventListener("submit", (e) => handleComicFormSubmit(e, config, appConfig));
  }
}

init();

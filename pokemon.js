/* ════════════════════════════════════════════════════════════════════
   pokemon.js — Pokémon TCG card lookup.
   Direct port of Ainz/pokemon.py to a client-side flow:
     1. (optional) A vision model reads the card name + collector number
        from an uploaded image.
     2. The name is resolved against TCGdex to the exact print.
     3. Live TCGplayer market prices are rendered.
   ════════════════════════════════════════════════════════════════════ */

const TCGDEX_BASE = "https://api.tcgdex.net/v2/en";
const ZEN_URL = "https://opencode.ai/zen/v1/chat/completions";
const ZEN_MODEL = "mimo-v2.5-free";
const KEY_STORAGE = "pokemon.zen_api_key";

const VISION_PROMPT =
  'You are a Pokemon TCG card identifier. Given an image of a Pokemon card, ' +
  'return ONLY valid JSON (no markdown, no code fences) with exactly these ' +
  'keys: "name" (the exact card name as printed on the card, e.g. ' +
  '"Celebi V" or "Professor\'s Research"), "collector" (the collector ' +
  'number printed at the bottom of the card as it appears, e.g. "12/165"), ' +
  'and "rarity". Example: {"name":"Celebi V","collector":"8/163","rarity":' +
  '"Holo Rare VMAX"}';

/* ── TCGplayer pricing variants (in display order) ─────────────────────── */
const TCGPLAYER_VARIANTS = [
  ["holofoil", "Holo"],
  ["reverseHolofoil", "Reverse Holo"],
  ["normal", "Normal"],
  ["1stEditionHolofoil", "1st Edition Holo"],
  ["unlimitedHolofoil", "Unlimited Holo"],
];

/* ════════════════════════════════════════════════════════════════════
   Small helpers (ported from pokemon.py)
   ════════════════════════════════════════════════════════════════════ */

function extractJson(text) {
  if (!text) return null;
  text = text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*/m, "").replace(/```$/m, "").trim();
  }
  const m = text.match(/\{.*\}/s);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function parseCollector(text) {
  if (!text) return null;
  text = String(text).trim();
  const m = text.match(/(\d{1,4})\s*\/\s*(\d{1,4})/);
  if (m) {
    return { type: "numbered", local: parseInt(m[1], 10), total: parseInt(m[2], 10) };
  }
  if (/[A-Za-z]+\d+/.test(text)) {
    return { type: "promo", code: text.replace(/[^A-Za-z0-9]/g, "").toUpperCase() };
  }
  return null;
}

function normalizeCode(value) {
  return String(value || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function digits(value) {
  if (value === null || value === undefined) return null;
  const d = String(value).replace(/[^\d]/g, "");
  return d ? parseInt(d, 10) : null;
}

/* ════════════════════════════════════════════════════════════════════
   Vision model
   ════════════════════════════════════════════════════════════════════ */

async function visionCall(dataUrl) {
  const key = localStorage.getItem(KEY_STORAGE);
  const headers = { "Content-Type": "application/json" };
  if (key) headers["Authorization"] = `Bearer ${key}`;

  const payload = {
    model: ZEN_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: VISION_PROMPT },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens: 4000,
    temperature: 0.2,
    response_format: { type: "json_object" },
  };

  const res = await fetch(ZEN_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Vision API responded with HTTP ${res.status}`);
  const data = await res.json();
  const content = (data.choices || [{}])[0]?.message?.content;
  return extractJson(content);
}

async function visionIdentify(dataUrl) {
  const vision = await visionCall(dataUrl);
  if (!vision) {
    throw new Error("The vision model could not identify the card. Add an OpenCode API Key or try the manual search below.");
  }
  const name = (vision.name || "").trim();
  if (!name) {
    throw new Error("The vision model didn't return a card name.");
  }
  const collector = parseCollector(vision.collector);
  const card = await matchCard(name, collector);
  return { card, vision: { name, collector: vision.collector, rarity: vision.rarity } };
}

/* ════════════════════════════════════════════════════════════════════
   TCGdex lookup
   ════════════════════════════════════════════════════════════════════ */

async function fetchFull(cardId) {
  const res = await fetch(`${TCGDEX_BASE}/cards/${cardId}`);
  if (!res.ok) throw new Error(`TCGdex responded with HTTP ${res.status}`);
  return res.json();
}

async function search(name) {
  const res = await fetch(`${TCGDEX_BASE}/cards?name=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`TCGdex responded with HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function matchCard(name, collector) {
  const results = await search(name);
  if (!results.length) return null;

  if (!collector) return fetchFull(results[0].id);

  if (collector.type === "promo") {
    const code = collector.code;
    let cand = results.filter((c) => normalizeCode(c.localId) === code);
    if (!cand.length) {
      // Fall back to the numeric tail (handles "SWSH1" vs "SWSH001").
      const tail = code.replace(/[^\d]/g, "");
      cand = results.filter((c) => tail && digits(c.localId) === parseInt(tail, 10));
    }
    if (!cand.length) cand = results;
    return fetchFull(cand[0].id);
  }

  // Numbered collector (e.g. "12/165").
  const localNo = collector.local;
  const totalNo = collector.total;
  const ranked = results
    .slice(0, 100)
    .map((c) => ({ score: digits(c.localId) === localNo ? 10 : 0, c }))
    .sort((a, b) => b.score - a.score);

  let best = null;
  for (const { score, c } of ranked.slice(0, 3)) {
    let full;
    try {
      full = await fetchFull(c.id);
    } catch {
      continue;
    }
    if (!full) continue;
    const cc = (full.set || {}).cardCount || {};
    const okTotal = totalNo === null || totalNo === undefined || totalNo === cc.official || totalNo === cc.total;
    if (score >= 10 && okTotal) return full;
    if (best === null) best = full;
  }
  return best;
}

/* ════════════════════════════════════════════════════════════════════
   Rendering
   ════════════════════════════════════════════════════════════════════ */

function categoryColor(category) {
  if (category === "Pokemon") return "#e03333";
  if (category === "Trainer") return "#60c4f5";
  return "#c9a84c"; // Energy / other
}

function priceProductId(tp) {
  for (const v of Object.values(tp)) {
    if (v && typeof v === "object" && v.productId) return v.productId;
  }
  return null;
}

function pricesHtml(tp) {
  // TCGdex keys vary between camelCase ("reverseHolofoil") and kebab-case
  // ("reverse-holofoil") depending on set — match on a normalized form.
  const norm = (k) => String(k || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const variants = [];
  for (const [key, label] of TCGPLAYER_VARIANTS) {
    const entry = Object.entries(tp).find(([k]) => norm(k) === norm(key));
    const v = entry ? entry[1] : null;
    if (v && typeof v === "object" && v.marketPrice !== null && v.marketPrice !== undefined) {
      variants.push({ label, v });
    }
  }

  if (!variants.length) {
    return `<p class="text-[13px] font-light" style="color:var(--text3)">No pricing data available.</p>`;
  }

  const usd = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);
  const rows = variants.slice(0, 3).map(
    ({ label, v }) => `
    <div class="flex items-center justify-between gap-4 py-2.5" style="border-bottom:1px solid var(--border)">
      <div class="flex-1 min-w-0">
        <div class="font-mono text-[10px] tracking-[0.14em] uppercase mb-0.5" style="color:var(--text2)">${label}</div>
        <div class="font-mono text-[10px] leading-tight" style="color:var(--text3)">
          Low ${usd(v.lowPrice)} · Mid ${usd(v.midPrice)} · High ${usd(v.highPrice)}
        </div>
      </div>
      <div class="pk-price text-[18px] flex-shrink-0">${usd(v.marketPrice)}</div>
    </div>`,
  );

  return `<div class="mb-4">
      <p class="font-mono text-[9px] tracking-[0.28em] uppercase mb-1" style="color:var(--text3)">Price (USD)</p>
      ${rows.join("")}
    </div>`;
}

function renderResult(card) {
  if (!card) {
    showError("No card found on TCGdex for that name.");
    return;
  }

  const container = $("results");
  const cardId = card.id || "";
  const name = card.name || "Unknown Card";
  const category = card.category;
  const color = categoryColor(category);
  const set = card.set || {};
  const localId = card.localId || "";
  const total = (set.cardCount || {}).total;
  const rarity = card.rarity || "—";
  const tp = (card.pricing || {}).tcgplayer || {};
  const pid = priceProductId(tp);
  const num = total ? `#${localId}/${total}` : `#${localId}`;

  container.classList.remove("hidden");
  container.innerHTML = `
    <div class="pk-result rounded-md overflow-hidden">
      <div class="pk-topbar" style="background:linear-gradient(90deg, ${color} 0%, #ff7070 100%)"></div>
      <div class="flex flex-col sm:flex-row gap-6 p-5 sm:p-6">
        <div class="flex-shrink-0 self-center sm:self-start w-[200px] sm:w-[220px] max-w-full">
          ${
            card.image
              ? `<img src="${card.image}/high.webp" alt="${escHtml(name)}" class="rounded-md block w-full" style="border:1px solid var(--border)" />`
              : `<div class="rounded-md w-full flex items-center justify-center" style="height:290px;background:var(--bg3);border:1px solid var(--border);font-size:56px">🃏</div>`
          }
        </div>

        <div class="flex-1 min-w-0">
          <p class="font-mono text-[9px] tracking-[0.3em] uppercase mb-2" style="color:${color}">${escHtml(category || "Card")}</p>
          <h2 class="font-display font-bold tracking-[0.02em] uppercase leading-none mb-3" style="font-size:clamp(24px,4vw,32px);color:var(--text)">${escHtml(name)}</h2>

          <div class="flex flex-wrap gap-1.5 mb-5">
            <span class="pk-badge">${escHtml(set.name || "Unknown set")}</span>
            <span class="pk-badge">${num}</span>
            <span class="pk-badge">${escHtml(rarity)}</span>
          </div>

          ${pricesHtml(tp)}

          ${
            pid
              ? `<a class="pk-link" href="https://www.tcgplayer.com/product/${pid}" target="_blank" rel="noopener">View on TCGplayer ↗</a>`
              : ""
          }
        </div>
      </div>
      <div class="pk-footer px-5 py-2.5 font-mono text-[9px] tracking-[0.08em] uppercase" style="color:var(--text3)">#${escHtml(cardId)} · via TCGdex</div>
    </div>`;
}

/* ════════════════════════════════════════════════════════════════════
   State / UI wiring
   ════════════════════════════════════════════════════════════════════ */

let currentDataUrl = null;

const $ = (id) => document.getElementById(id);

function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function showError(msg) {
  const box = $("errorBox");
  box.textContent = msg;
  box.style.display = "block";
}

function clearError() {
  const box = $("errorBox");
  box.style.display = "none";
  box.textContent = "";
}

function setLoading(on) {
  $("loader").style.display = on ? "flex" : "none";
  if (!on) $("metaText").textContent = "";
}

function showLoader(html) {
  $("loader").style.display = html ? "flex" : "none";
  $("metaText").innerHTML = html;
}

/* ── Dropzone ── */
function setupDropzone() {
  const dropzone = $("dropzone");
  const fileInput = $("fileInput");

  dropzone.addEventListener("click", () => fileInput.click());

  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    }),
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    }),
  );
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) loadImage(file);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files?.[0]) loadImage(fileInput.files[0]);
  });

  document.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          loadImage(file);
          break;
        }
      }
    }
  });
}

function loadImage(file) {
  if (!file.type.startsWith("image/")) {
    showError("Please choose an image file.");
    return;
  }
  clearError();
  const reader = new FileReader();
  reader.onload = (e) => {
    currentDataUrl = e.target.result;
    const preview = $("dzPreview");
    preview.src = currentDataUrl;
    preview.style.display = "block";
    $("dzEmpty").style.display = "none";
    showLoader(`Loaded <strong style="color:var(--text)">${escHtml(file.name)}</strong> — ready to identify.`);
  };
  reader.readAsDataURL(file);
}

/* ── API key ── */
function setupKeyField() {
  const input = $("apiKeyInput");
  const button = $("keySave");
  const updateSaveLabel = (val) => {
    button.textContent = val ? "Saved ✓" : "Save Key";
    button.classList.toggle("saved", !!val);
  };
  const restore = () => {
    const saved = localStorage.getItem(KEY_STORAGE);
    input.value = saved || "";
    updateSaveLabel(saved);
  };
  input.addEventListener("input", () => updateSaveLabel(null));
  button.addEventListener("click", () => {
    const val = input.value.trim();
    if (val) {
      localStorage.setItem(KEY_STORAGE, val);
    } else {
      localStorage.removeItem(KEY_STORAGE);
    }
    updateSaveLabel(val);
    showLoader("API key saved in this browser.");
    clearError();
  });
  restore();
}

/* ════════════════════════════════════════════════════════════════════
   Actions
   ════════════════════════════════════════════════════════════════════ */

async function onIdentifyClick() {
  if (!currentDataUrl) {
    showError("Drop or paste an image first, or use the manual search below.");
    return;
  }
  $("results").classList.add("hidden");
  clearError();
  setLoading(true);
  showLoader("Reading card with vision model…");
  try {
    const { card, vision } = await visionIdentify(currentDataUrl);
    setLoading(false);
    showLoader(
      `Identified <strong style="color:var(--text)">${escHtml(vision.name)}</strong>` +
        (vision.collector ? ` · <strong style="color:var(--text)">${escHtml(vision.collector)}</strong>` : "") +
        (vision.rarity ? ` · ${escHtml(vision.rarity)}` : ""),
    );
    renderResult(card);
  } catch (err) {
    setLoading(false);
    showLoader("");
    showError(`Failed: ${err.message}`);
  }
}

async function onSearchClick() {
  const name = $("nameInput").value.trim();
  if (!name) {
    showError("Enter a card name to search.");
    return;
  }
  const collectorText = $("collectorInput").value.trim() || null;
  $("results").classList.add("hidden");
  clearError();
  setLoading(true);
  showLoader(`Searching TCGdex for <strong style="color:var(--text)">${escHtml(name)}</strong>…`);
  try {
    const collector = parseCollector(collectorText);
    const card = await matchCard(name, collector);
    setLoading(false);
    if (card) {
      showLoader(`Found <strong style="color:var(--text)">${escHtml(card.name || name)}</strong> on TCGdex.`);
    } else {
      showLoader("");
    }
    renderResult(card);
  } catch (err) {
    setLoading(false);
    showLoader("");
    showError(`Failed: ${err.message}`);
  }
}

/* ════════════════════════════════════════════════════════════════════
   Init
   ════════════════════════════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {
  setupDropzone();
  setupKeyField();

  $("identifyBtn").addEventListener("click", onIdentifyClick);
  $("searchBtn").addEventListener("click", onSearchClick);

  ["nameInput", "collectorInput"].forEach((id) => {
    $(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") onSearchClick();
    });
  });
});
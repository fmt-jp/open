// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
const THEME_KEY = "fx_tracker_theme";
const THEME_BAR_COLORS = { ocean: "#0A1826", gold: "#17130D", silver: "#14171A" };
function applyTheme(name) {
  document.documentElement.className = name === "ocean" ? "" : `theme-${name}`;
  // keep the Android status bar / browser chrome in sync with the active theme
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_BAR_COLORS[name] || THEME_BAR_COLORS.ocean);
  try { localStorage.setItem(THEME_KEY, name); } catch {}
}
function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || "ocean"; } catch { return "ocean"; }
}
function setTheme(name) {
  applyTheme(name);
  render();
}
applyTheme(getTheme());

// ---------------------------------------------------------------------------
// Field schema (mirrors the source "余力確認" screen)
// ---------------------------------------------------------------------------
const FIELD_GROUPS = [
  { label: "口座情報", fields: [
    { key: "torihiki_yoryoku", label: "取引余力", unit: "円" },
    { key: "furikae_kanogaku", label: "振替可能額", unit: "円" },
    { key: "shokyokin_iji", label: "証拠金維持率", unit: "%" },
  ]},
  { label: "拘束証拠金", fields: [
    { key: "kosoku_shokyokin", label: "拘束証拠金", unit: "円" },
    { key: "hitsuyo_shokyokin", label: "必要証拠金", unit: "円", indent: true },
    { key: "chumonchu_shokyokin", label: "注文中証拠金", unit: "円", indent: true },
  ]},
  { label: "評価", fields: [
    { key: "jika_hyoka_sogaku", label: "時価評価総額", unit: "円" },
    { key: "tategyoku_hyoka_sogaku", label: "建玉評価総額", unit: "円" },
    { key: "mikessai_hyoka_songi", label: "未決済建玉評価損益", unit: "円", indent: true },
    { key: "ruikei_swap", label: "累計スワップ", unit: "円", indent: true },
  ]},
  { label: "口座残高", fields: [
    { key: "kouza_zandaka", label: "口座残高", unit: "円" },
    { key: "genkin_zandaka", label: "現金残高", unit: "円", indent: true },
    { key: "kikessai_songi", label: "既決済取引損益", unit: "円", indent: true },
    { key: "swap_songi", label: "スワップ損益", unit: "円", indent: true },
    { key: "tesuryo_gokei", label: "手数料合計", unit: "円", indent: true },
    { key: "furikae_shijigaku", label: "振替入出金指示額", unit: "円", indent: true },
  ]},
];
const ALL_FIELDS = FIELD_GROUPS.flatMap(g => g.fields);
const FIELD_MAP = Object.fromEntries(ALL_FIELDS.map(f => [f.key, f]));
const STORAGE_KEY = "fx_tracker_entries_v1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const todayStr = () => {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
};
const emptyValues = () => Object.fromEntries(ALL_FIELDS.map(f => [f.key, ""]));
const fmt = (n, unit) => {
  if (n === "" || n === null || n === undefined || isNaN(n)) return "—";
  const num = Number(n);
  const s = unit === "%" ? num.toFixed(2) : Math.round(num).toLocaleString("ja-JP");
  return unit === "%" ? `${s}%` : `${s} ${unit}`;
};
const parseNum = (raw) => {
  if (raw === "" || raw === null || raw === undefined) return "";
  const cleaned = String(raw).replace(/[,\s円%]/g, "").replace(/^\+/, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? "" : n;
};
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return list.sort((a, b) => a.date.localeCompare(b.date));
  } catch { return []; }
}
function saveEntries(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
  catch { state.error = "保存に失敗しました（ブラウザのストレージ容量やプライベートモードをご確認ください）。"; }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  entries: loadEntries(),
  tab: "list", // list | add | chart
  form: { date: todayStr(), values: emptyValues() },
  error: "",
  selectedFields: ["jika_hyoka_sogaku", "shokyokin_iji"],
  range: { from: "", to: "" },
  fieldPickerOpen: false,
  ocrStatus: "idle", // idle | loading | done | error
  ocrProgress: 0,
  ocrError: "",
  editingId: null,
};
let chartInstance = null;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function setTab(tab) {
  // arriving at "add" via the nav bar (not via startEdit) should start a fresh form
  if (tab === "add" && state.tab !== "add" && !state.editingId) {
    resetForm();
  }
  state.tab = tab;
  render();
}
function setDate(v) { state.form.date = v; }
function setValue(key, v) { state.form.values[key] = v; }
function toggleFieldPicker() { state.fieldPickerOpen = !state.fieldPickerOpen; render(); }
function toggleSelectedField(key) {
  const i = state.selectedFields.indexOf(key);
  if (i >= 0) state.selectedFields.splice(i, 1);
  else if (state.selectedFields.length < 3) state.selectedFields.push(key);
  render();
}
function setRange(part, v) { state.range[part] = v; render(); }
function clearRange() { state.range = { from: "", to: "" }; render(); }

function resetForm() {
  state.form = { date: todayStr(), values: emptyValues() };
  state.editingId = null;
  state.error = "";
  state.ocrStatus = "idle";
  state.ocrError = "";
}

function startEdit(id) {
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  state.editingId = id;
  state.form.date = entry.date;
  state.form.values = Object.fromEntries(
    ALL_FIELDS.map(f => [f.key, entry.values[f.key] === "" || entry.values[f.key] === undefined ? "" : String(entry.values[f.key])])
  );
  state.error = "";
  state.ocrStatus = "idle";
  state.tab = "add";
  render();
}
function cancelEdit() {
  resetForm();
  state.tab = "list";
  render();
}

function handleAdd() {
  const dateEl = document.getElementById("date-input");
  if (dateEl) state.form.date = dateEl.value;
  if (!state.form.date) { state.error = "日付を入力してください。"; render(); return; }
  const hasAny = ALL_FIELDS.some(f => {
    const el = document.getElementById("val-" + f.key);
    return el && el.value !== "";
  });
  if (!hasAny) { state.error = "少なくとも1つの項目を入力してください。"; render(); return; }

  const parsedValues = {};
  ALL_FIELDS.forEach(f => {
    const el = document.getElementById("val-" + f.key);
    parsedValues[f.key] = parseNum(el ? el.value : "");
  });
  const editingId = state.editingId;
  const newEntry = { id: editingId || `${state.form.date}-${Date.now()}`, date: state.form.date, values: parsedValues };
  // drop the entry being edited (by id) and any other entry that already occupies the target date
  const base = state.entries.filter(e => e.id !== editingId && e.date !== state.form.date);
  state.entries = [...base, newEntry].sort((a, b) => a.date.localeCompare(b.date));
  saveEntries(state.entries);
  resetForm();
  state.tab = "list";
  render();
}
function handleDelete(id) {
  state.entries = state.entries.filter(e => e.id !== id);
  saveEntries(state.entries);
  render();
}

function exportCSV() {
  if (state.entries.length === 0) return;
  const header = ["日付", ...ALL_FIELDS.map(f => `${f.label}(${f.unit})`)];
  const rows = [...state.entries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => [
      e.date,
      ...ALL_FIELDS.map(f => (e.values[f.key] === "" || e.values[f.key] === undefined ? "" : e.values[f.key])),
    ]);
  const csv = [header, ...rows].map(row => row.join(",")).join("\r\n");
  // prepend a UTF-8 BOM so Excel opens the Japanese text correctly instead of mojibake
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = todayStr().replace(/-/g, "");
  a.href = url;
  a.download = `FX_LIFE_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- OCR ----

// Upscale the image before OCR — bigger, crisper glyphs meaningfully improve digit accuracy.
function upscaleImage(file, scale = 2) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
      img.src = ev.target.result;
    };
    reader.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
    reader.readAsDataURL(file);
  });
}

// Find `label` inside `line`, tolerating up to `maxErr` misread characters
// (Tesseract occasionally reads one kanji wrong, e.g. 余→才, which breaks an exact match).
function fuzzyIndexOf(line, label, maxErr = 1) {
  const n = label.length;
  for (let i = 0; i <= line.length - n; i++) {
    let errs = 0;
    for (let j = 0; j < n; j++) {
      if (line[i + j] !== label[j]) errs++;
      if (errs > maxErr) break;
    }
    if (errs <= maxErr) return i;
  }
  return -1;
}

// Pull the number that immediately follows a label out of the remaining line text.
// Yen fields are always whole integers here, but OCR sometimes misreads the "," thousands
// separator as "." — treating both the same for yen avoids truncating the number at a
// stray decimal point. The percentage field is the only one with a genuine decimal part.
function extractNumberAfter(after, unit) {
  if (unit === "%") {
    const m = after.match(/^[^\d+\-]{0,4}([-+]?\d[\d,]*\.\d+|[-+]?\d[\d,]*)/);
    if (!m) return null;
    const num = parseFloat(m[1].replace(/,/g, ""));
    return isNaN(num) ? null : num;
  }
  const m = after.match(/^[^\d+\-]{0,4}([-+]?\d[\d,.]*)/);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/[,.]/g, ""));
  return isNaN(num) ? null : num;
}

function extractFieldsFromText(text) {
  // normalize full-width digits/punctuation (０-９, ，, ．, ＋, －, 　) to their ASCII
  // equivalents — Japanese OCR output often uses these, and a bare regex \d only
  // matches ASCII 0-9, so without this a number could get cut short mid-read.
  const normalized = (text || "").normalize("NFKC");
  const rawLines = normalized.split("\n").map(l => l.trim()).filter(Boolean);
  // strip all whitespace so OCR's occasional stray spaces between characters don't break matching
  const lines = rawLines.map(l => l.replace(/\s+/g, ""));
  const result = {};
  // sort labels longest-first so a longer label (e.g. 拘束証拠金) is preferred over a shorter one
  // that happens to be a substring of it (e.g. 証拠金 patterns), avoiding mismatches
  const sortedFields = [...ALL_FIELDS].sort((a, b) => b.label.length - a.label.length);
  sortedFields.forEach(f => {
    let best = null;
    for (const line of lines) {
      const idx = fuzzyIndexOf(line, f.label, 1);
      if (idx === -1) continue;
      // only look at the number immediately following the label on that same line —
      // taking "the last number anywhere in the line" was grabbing unrelated fragments
      const after = line.slice(idx + f.label.length);
      const num = extractNumberAfter(after, f.unit);
      if (num !== null) {
        // if the label matched on more than one line, keep whichever candidate has more
        // digits — the fuller, more plausible reading of the actual value
        if (best === null || Math.abs(num).toString().replace(".", "").length > Math.abs(best).toString().replace(".", "").length) {
          best = num;
        }
      }
    }
    if (best !== null) result[f.key] = best;
  });
  return result;
}

function dateFromFile(file) {
  if (file && file.lastModified) {
    const d = new Date(file.lastModified);
    if (!isNaN(d.getTime())) {
      const tz = d.getTimezoneOffset() * 60000;
      return new Date(d - tz).toISOString().slice(0, 10);
    }
  }
  return null;
}

// Read the EXIF capture date directly out of the image bytes (PNG "eXIf" chunk or JPEG
// APP1 segment). Many Android screenshots embed a real DateTimeOriginal here even though
// the file's on-disk "last modified" time often just reflects when it was copied/shared,
// which is why that fallback alone was unreliable.
function parseTiffDate(view, tiffStart) {
  const little = view.getUint16(tiffStart) === 0x4949;
  const getU16 = (o) => view.getUint16(o, little);
  const getU32 = (o) => view.getUint32(o, little);
  function readIFD(offset) {
    const count = getU16(tiffStart + offset);
    const entries = {};
    let p = tiffStart + offset + 2;
    for (let i = 0; i < count; i++) {
      entries[getU16(p)] = { numValues: getU32(p + 4), valueOffset: p + 8 };
      p += 12;
    }
    return entries;
  }
  function getAscii(entry) {
    const dataOffset = entry.numValues <= 4 ? entry.valueOffset : tiffStart + getU32(entry.valueOffset);
    let str = "";
    for (let i = 0; i < entry.numValues - 1; i++) str += String.fromCharCode(view.getUint8(dataOffset + i));
    return str;
  }
  const ifd0 = readIFD(getU32(tiffStart + 4));
  let dateStr = null;
  if (ifd0[0x8769]) {
    const exifIfd = readIFD(getU32(ifd0[0x8769].valueOffset));
    dateStr = (exifIfd[0x9003] && getAscii(exifIfd[0x9003])) || (exifIfd[0x9004] && getAscii(exifIfd[0x9004])) || null;
  }
  if (!dateStr && ifd0[0x0132]) dateStr = getAscii(ifd0[0x0132]);
  if (!dateStr) return null;
  const m = dateStr.match(/^(\d{4}):(\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function extractExifDate(arrayBuffer) {
  try {
    const view = new DataView(arrayBuffer);
    if (view.byteLength < 16) return null;
    if (view.getUint32(0) === 0x89504e47) { // PNG signature
      let pos = 8;
      while (pos < view.byteLength - 8) {
        const length = view.getUint32(pos);
        const type = String.fromCharCode(view.getUint8(pos + 4), view.getUint8(pos + 5), view.getUint8(pos + 6), view.getUint8(pos + 7));
        if (type === "eXIf") return parseTiffDate(view, pos + 8);
        if (type === "IDAT") break;
        pos += 8 + length + 4;
      }
      return null;
    }
    if (view.getUint16(0) === 0xffd8) { // JPEG signature
      let pos = 2;
      while (pos < view.byteLength - 4) {
        if (view.getUint8(pos) !== 0xff) break;
        const marker = view.getUint8(pos + 1);
        const size = view.getUint16(pos + 2);
        if (marker === 0xe1 && String.fromCharCode(view.getUint8(pos + 4), view.getUint8(pos + 5), view.getUint8(pos + 6), view.getUint8(pos + 7)) === "Exif") {
          return parseTiffDate(view, pos + 10);
        }
        pos += 2 + size;
      }
      return null;
    }
    return null;
  } catch {
    return null;
  }
}
async function dateFromExif(file) {
  try {
    const buf = await file.arrayBuffer();
    return extractExifDate(buf);
  } catch {
    return null;
  }
}

async function handleImageFile(file) {
  if (!file) return;
  state.ocrStatus = "loading";
  state.ocrProgress = 0;
  state.ocrError = "";

  // prefer the image's real EXIF capture date; many Android screenshots embed one even
  // though the file's "last modified" time often just reflects when it was copied/shared
  const guessedDate = (await dateFromExif(file)) || dateFromFile(file);
  if (guessedDate) {
    state.form.date = guessedDate;
    const dateEl = document.getElementById("date-input");
    if (dateEl) dateEl.value = guessedDate;
  }
  render();
  try {
    const upscaled = await upscaleImage(file, 2);
    const { data } = await Tesseract.recognize(upscaled, "jpn+eng", {
      tessedit_pageseg_mode: 6, // assume a single uniform block of text — suits this list layout
      logger: (m) => {
        if (typeof m.progress === "number") {
          state.ocrProgress = Math.round(m.progress * 100);
          const fill = document.getElementById("ocr-progress-fill");
          const label = document.getElementById("ocr-progress-label");
          if (fill) fill.style.width = state.ocrProgress + "%";
          if (label) label.textContent = `解析中… ${state.ocrProgress}%`;
        }
      },
    });
    const extracted = extractFieldsFromText(data.text || "");
    if (Object.keys(extracted).length === 0) {
      state.ocrStatus = "error";
      state.ocrError = "数値を読み取れませんでした。画像の明るさ・傾きを確認するか、手入力してください。";
    } else {
      ALL_FIELDS.forEach(f => {
        if (extracted[f.key] !== undefined) state.form.values[f.key] = extracted[f.key];
      });
      state.ocrStatus = "done";
    }
  } catch (e) {
    state.ocrStatus = "error";
    state.ocrError = (e && e.message) || "OCR処理に失敗しました。";
  }
  render();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <header>
      <div class="header-title-row">
        <div class="header-title-left">
          <span class="header-mark"></span>
          <h1>FX LIFE</h1>
        </div>
        <div class="theme-switcher">
          <button class="theme-dot-btn ${getTheme() === "ocean" ? "active" : ""}" onclick="setTheme('ocean')" aria-label="オーシャン"><span class="theme-dot ocean"></span></button>
          <button class="theme-dot-btn ${getTheme() === "gold" ? "active" : ""}" onclick="setTheme('gold')" aria-label="ゴールド"><span class="theme-dot gold"></span></button>
          <button class="theme-dot-btn ${getTheme() === "silver" ? "active" : ""}" onclick="setTheme('silver')" aria-label="シルバー"><span class="theme-dot silver"></span></button>
        </div>
      </div>
      <p class="header-sub">365FX 余力確認の推移</p>
    </header>
    <nav class="tabs">
      <button class="tab-btn ${state.tab === "list" ? "active" : ""}" onclick="setTab('list')">記録</button>
      <button class="tab-btn ${state.tab === "add" ? "active" : ""}" onclick="setTab('add')">追加</button>
      <button class="tab-btn ${state.tab === "chart" ? "active" : ""}" onclick="setTab('chart')">グラフ</button>
    </nav>
    <main>${state.tab === "list" ? renderList() : state.tab === "add" ? renderAdd() : renderChart()}</main>
  `;
  if (state.tab === "add") bindAddInputs();
  if (state.tab === "chart") drawChart();
}

function renderList() {
  if (state.entries.length === 0) {
    return `
      <div class="empty-state">
        <p class="empty-title">まだ記録がありません</p>
        <p class="empty-body">スクリーンショットを読み込むか、数字を入力して最初の記録を残しましょう。</p>
        <button class="primary-btn" style="width:auto;padding:11px 20px;" onclick="setTab('add')">記録を追加</button>
      </div>`;
  }
  const reversed = [...state.entries].reverse();
  // display order for the list card
  const displayKeys = ["jika_hyoka_sogaku", "mikessai_hyoka_songi", "ruikei_swap", "kouza_zandaka", "shokyokin_iji"];
  return `
    <div style="display:flex;justify-content:flex-end;">
      <button class="selector-btn" style="width:auto;padding:8px 14px;font-size:12.5px;" onclick="exportCSV()">⭳ CSVをエクスポート</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;">
    ${reversed.map(e => {
      return `
      <div class="card">
        <div class="card-head">
          <span class="card-date">${escapeHtml(e.date)}</span>
          <div style="display:flex;gap:2px;">
            <button class="icon-btn" onclick="startEdit('${e.id}')" aria-label="編集">✎</button>
            <button class="icon-btn" onclick="handleDelete('${e.id}')" aria-label="削除">✕</button>
          </div>
        </div>
        <div class="card-fields">
          ${displayKeys.map((k, i) => {
            const f = FIELD_MAP[k];
            const v = e.values[k];
            const isPrimary = k === "jika_hyoka_sogaku";
            const isLossField = k === "mikessai_hyoka_songi";
            const negative = isLossField && v !== "" && v !== null && v !== undefined && Number(v) < 0;
            const valueStyle = [
              isPrimary ? "font-size:17px;font-weight:700;" : "font-size:13.5px;font-weight:600;",
              negative ? "color:#F97A6B;" : "",
            ].join("");
            return `
              <div class="card-field-row" style="${i > 0 ? "border-top:1px solid #16293F;" : ""}">
                <span class="card-field-label">${f.label}</span>
                <span class="card-field-value" style="${valueStyle}">${fmt(v, f.unit)}</span>
              </div>`;
          }).join("")}
        </div>
      </div>`;
    }).join("")}
  </div>`;
}

function renderAdd() {
  const ocrLabel = state.ocrStatus === "loading" ? `解析中… ${state.ocrProgress}%`
    : state.ocrStatus === "done" ? "読み取り完了・内容を確認してください"
    : "スクリーンショットから読み込む";
  const ocrIcon = state.ocrStatus === "loading" ? `<span class="spin">⏳</span>`
    : state.ocrStatus === "done" ? "✓" : "🖼";

  return `
    <div class="image-drop">
      <div class="image-btn-wrap">
        <button type="button" id="image-pick-btn" class="image-btn" style="width:100%;border:1px solid #234561;opacity:${state.ocrStatus === "loading" ? 0.6 : 1}" ${state.ocrStatus === "loading" ? "disabled" : ""}>
          <span id="ocr-progress-label">${ocrIcon} ${ocrLabel}</span>
        </button>
        <input type="file" id="image-file-input" accept="image/*" style="display:none;" />
      </div>
      ${state.ocrStatus === "loading" ? `
        <div class="progress-bar-track"><div id="ocr-progress-fill" class="progress-bar-fill" style="width:${state.ocrProgress}%"></div></div>
      ` : ""}
      ${state.ocrStatus === "error" ? `<p class="image-error-text">${escapeHtml(state.ocrError)}</p>` : ""}
      <p class="image-hint">「余力確認」画面のスクリーンショットを選ぶと、ブラウザ内のOCR処理で数値を自動入力します（外部送信なし）。内容は保存前に確認・修正できます。</p>
    </div>

    <div class="field-block">
      <label class="field-label">${state.editingId ? "日付（編集中）" : "日付"}</label>
      <input id="date-input" type="date" class="date-input" value="${escapeHtml(state.form.date)}" />
    </div>

    ${FIELD_GROUPS.map(group => `
      <div class="group">
        <div class="group-label">${group.label}</div>
        <div style="display:flex;flex-direction:column;gap:9px;">
          ${group.fields.map(f => `
            <div class="input-row" style="margin-left:${f.indent ? "14px" : "0"}">
              <label class="input-row-label">${f.label}</label>
              <div class="input-wrap">
                <input id="val-${f.key}" inputmode="decimal" placeholder="0" class="num-input"
                  value="${escapeHtml(state.form.values[f.key])}" />
                <span class="input-unit">${f.unit}</span>
              </div>
            </div>`).join("")}
        </div>
      </div>`).join("")}

    ${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ""}
    <button class="primary-btn" onclick="handleAdd()">${state.editingId ? "変更を保存" : "記録を保存"}</button>
    ${state.editingId ? `<button class="primary-btn" style="background:transparent;color:#8FA6BF;border:1px solid #1D3348;margin-top:0;" onclick="cancelEdit()">編集をキャンセル</button>` : ""}
  `;
}

function bindAddInputs() {
  ALL_FIELDS.forEach(f => {
    const el = document.getElementById("val-" + f.key);
    if (el) el.addEventListener("input", () => setValue(f.key, el.value));
  });
  const dateEl = document.getElementById("date-input");
  if (dateEl) dateEl.addEventListener("input", () => setDate(dateEl.value));

  const pickBtn = document.getElementById("image-pick-btn");
  const fileInput = document.getElementById("image-file-input");
  if (pickBtn && fileInput) {
    pickBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      handleImageFile(file);
      e.target.value = "";
    });
  }
}

function getFilteredEntries() {
  let list = state.entries;
  if (state.range.from) list = list.filter(e => e.date >= state.range.from);
  if (state.range.to) list = list.filter(e => e.date <= state.range.to);
  return list;
}

function renderChart() {
  if (state.entries.length < 2) {
    return `
      <div class="empty-state">
        <p class="empty-title">グラフを表示するには記録が2件以上必要です</p>
        <p class="empty-body">現在 ${state.entries.length} 件記録されています。追加タブからもう少し記録してください。</p>
      </div>`;
  }
  const filtered = getFilteredEntries();
  return `
    <div>
      <button class="selector-btn" onclick="toggleFieldPicker()">
        <span>${state.selectedFields.length === 0 ? "項目を選択" : state.selectedFields.map(k => FIELD_MAP[k].label).join(" ・ ")}</span>
        <span style="color:#5B7B99">${state.fieldPickerOpen ? "▲" : "▼"}</span>
      </button>
      ${state.fieldPickerOpen ? `
        <div class="field-picker">
          ${FIELD_GROUPS.map(group => `
            <div class="picker-group-label">${group.label}</div>
            <div class="chip-row">
              ${group.fields.map(f => `
                <button class="chip ${state.selectedFields.includes(f.key) ? "active" : ""}" onclick="toggleSelectedField('${f.key}')">${f.label}</button>
              `).join("")}
            </div>
          `).join("")}
          <p class="picker-hint">最大3項目まで選択できます（水色＝選択中。もう一度タップすると解除されます）</p>
        </div>` : ""}
    </div>

    <div class="range-row">
      <div class="range-field">
        <span class="range-label">開始</span>
        <input type="date" class="date-input-small" value="${escapeHtml(state.range.from)}" onchange="setRange('from', this.value)" />
      </div>
      <div class="range-field">
        <span class="range-label">終了</span>
        <input type="date" class="date-input-small" value="${escapeHtml(state.range.to)}" onchange="setRange('to', this.value)" />
      </div>
      ${(state.range.from || state.range.to) ? `<button class="icon-btn" onclick="clearRange()">✕</button>` : ""}
    </div>

    <div class="chart-card">
      ${state.selectedFields.length === 0
        ? `<p class="empty-body" style="text-align:center;padding:30px 0;">項目を選択してください</p>`
        : filtered.length === 0
          ? `<div style="text-align:center;padding:20px 10px;">
               <p class="empty-body" style="margin-bottom:8px;">指定した期間に一致する記録がありません。</p>
               <p class="empty-body">保存されている日付：${state.entries.map(e => escapeHtml(e.date)).join(" ／ ")}</p>
             </div>`
          : filtered.length === 1
            ? `<p class="empty-body" style="text-align:center;padding:30px 0;">この期間には記録が1件しかないため、線グラフは表示できません。期間を広げてください。</p>`
            : `<div class="chart-canvas-wrap"><canvas id="fx-chart"></canvas></div>`}
    </div>
  `;
}

function drawChart() {
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  if (state.selectedFields.length === 0) return;
  const canvas = document.getElementById("fx-chart");
  if (!canvas) return; // no canvas means the empty/1-point message is showing instead

  if (typeof Chart === "undefined") {
    const wrap = canvas.closest(".chart-canvas-wrap");
    if (wrap) wrap.outerHTML = `<p class="image-error-text" style="padding:20px 0;text-align:center;">グラフ描画ライブラリの読み込みに失敗しました。通信環境を確認し、ページを再読み込みしてください。</p>`;
    return;
  }

  const list = getFilteredEntries();
  const PERCENT_KEY = "shokyokin_iji";
  const hasPercent = state.selectedFields.includes(PERCENT_KEY);

  // read the active theme's colors so the chart matches the current palette
  const rootStyle = getComputedStyle(document.documentElement);
  const cv = (name, fallback) => (rootStyle.getPropertyValue(name).trim() || fallback);
  const themeAccent = cv("--accent", "#5EEAD4");
  const themePanel = cv("--panel", "#0F2138");
  const themeBorder = cv("--border", "#1D3348");
  const themeMuted = cv("--text-muted", "#5B7B99");
  const themeDim = cv("--text-dim", "#8FA6BF");
  const themeText = cv("--text", "#E7EFF6");
  const lineColors = [themeAccent, "#F97A6B", "#93C5FD", "#FBBF24", "#C4B5FD"];

  const labels = list.map(e => e.date.slice(5));
  const datasets = state.selectedFields.map((k, i) => ({
    label: FIELD_MAP[k].label,
    data: list.map(e => (e.values[k] === "" || e.values[k] === undefined ? null : e.values[k])),
    borderColor: lineColors[i % lineColors.length],
    backgroundColor: lineColors[i % lineColors.length],
    tension: 0.35,
    pointRadius: 3,
    spanGaps: true,
    yAxisID: k === PERCENT_KEY ? "yPercent" : "y",
  }));

  chartInstance = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false, // without this, a canvas in a flex column with no fixed
                                    // height can grow indefinitely and render nothing visible
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: state.selectedFields.length > 1, labels: { color: themeDim, font: { size: 11 } } },
        tooltip: {
          backgroundColor: themePanel,
          borderColor: themeBorder,
          borderWidth: 1,
          titleColor: themeDim,
          bodyColor: themeText,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y, FIELD_MAP[state.selectedFields[ctx.datasetIndex]].unit)}`
          }
        },
      },
      scales: {
        x: { ticks: { color: themeMuted, font: { size: 10 } }, grid: { color: themeBorder } },
        y: {
          position: "left",
          ticks: { color: themeMuted, font: { size: 10 } },
          grid: { color: themeBorder },
        },
        // separate right-hand axis for 証拠金維持率 (%), since its scale is unrelated to the yen amounts
        ...(hasPercent ? {
          yPercent: {
            position: "right",
            ticks: { color: themeMuted, font: { size: 10 }, callback: (v) => `${v}%` },
            grid: { drawOnChartArea: false },
          },
        } : {}),
      },
    },
  });
}

render();
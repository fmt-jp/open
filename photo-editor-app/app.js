/* =========================================================================
   写真かくす加工 — すべての画像処理は端末内(このブラウザのJS)だけで完結する。
   fetch/XHR で写真データを外部へ送信する処理は一切存在しない。
   ========================================================================= */

const MAX_EDIT_DIM = 1600;      // 編集・保存に使う長辺の最大ピクセル数(端末負荷対策)
const FACE_MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
const EXIFJS_URL  = 'https://cdnjs.cloudflare.com/ajax/libs/exif-js/2.3.0/exif.js';
const FACEAPI_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';

// 外部ライブラリの遅延読み込み(起動時は読み込まず、実際に使う時だけ取得する)
const _scriptCache = {};
function loadScriptOnce(src, timeoutMs = 10000) {
  if (_scriptCache[src]) return _scriptCache[src];
  _scriptCache[src] = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('script load timeout: ' + src)), timeoutMs);
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => { clearTimeout(timer); resolve(); };
    s.onerror = () => { clearTimeout(timer); reject(new Error('script load failed: ' + src)); };
    document.head.appendChild(s);
  });
  return _scriptCache[src];
}

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------- DOM refs ---------- */
const els = {
  pickerScreen: $('#picker-screen'),
  editorScreen: $('#editor-screen'),
  fileInput:    $('#file-input'),
  cameraInput:  $('#camera-input'),
  filename:     $('#filename'),
  btnReset:     $('#btn-reset'),
  btnSave:      $('#btn-save'),
  canvasWrap:   $('#canvas-wrap'),
  canvas:       $('#preview'),
  cropOverlay:  $('#crop-overlay'),
  cropFrame:    $('#crop-frame'),
  hideOverlay:  $('#hide-overlay'),
  canvasHint:   $('#canvas-hint'),
  bottombar:    $('#bottombar'),
  panels: { crop: $('#panel-crop'), exif: $('#panel-exif'), hide: $('#panel-hide') },
  cropApply:  $('#crop-apply'),
  cropCancel: $('#crop-cancel'),
  exifEmpty:  $('#exif-empty'),
  exifFields: $('#exif-fields'),
  exifPos:    $('#exif-position'),
  exifSize:   $('#exif-size'),
  exifColor:  $('#exif-color'),
  exifColorCustom: $('#exif-color-custom'),
  exifOutline: $('#exif-outline'),
  hideStatus: $('#hide-status'),
  hideDetect: $('#hide-detect'),
  hideAdd:    $('#hide-add'),
  hideMethod: $('#hide-method'),
  hideList:   $('#hide-list'),
  toast:      $('#toast'),
  loading:    $('#loading-overlay'),
  loadingText:$('#loading-text'),
};
const ctx = els.canvas.getContext('2d');

/* ---------- Global state ---------- */
const state = {
  mode: 'crop',
  originalBase: null,     // canvas: 元写真(向き補正済・長辺MAX_EDIT_DIM以下)
  exifData: null,         // exif-js が読み取った生データ
  crop: {                 // 現在の(未適用)クロップ表示状態。座標は originalBase 基準
    aspect: 'free',
    srcX: 0, srcY: 0, srcW: 0, srcH: 0,
  },
  appliedCropRect: null,  // 直近に「適用」されたクロップ範囲(originalBase基準)。nullなら全体
  workingBase: null,      // canvas: クロップ確定後の画像(EXIF/隠す処理の土台)
  exif: {                 // 焼き込み設定
    fields: {},           // { datetime:true, make:false, ... }
    position: 'left',
    size: 26,
    color: '#ffffff',
    colorPreset: 'white',
    outline: 'white-black',
  },
  hideRegions: [],         // { id, x,y,w,h (workingBase基準), type:'face'|'plate'|'manual', method:'mosaic'|'icon', enabled }
  hideMethod: 'mosaic',
  faceModelReady: false,
  detecting: false,
};

let regionSeq = 1;

/* ========================================================================
   ユーティリティ
   ======================================================================== */
function toast(msg, ms = 2200) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove('show'), ms);
}
function showLoading(msg) { els.loadingText.textContent = msg || '処理中…'; els.loading.hidden = false; }
function hideLoading() { els.loading.hidden = true; }

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/* ========================================================================
   1. 写真の読み込み(+ EXIF Orientation 補正)
   ======================================================================== */
els.fileInput.addEventListener('change', e => handleFile(e.target.files[0]));
els.cameraInput.addEventListener('change', e => handleFile(e.target.files[0]));

function handleFile(file) {
  if (!file) return;
  els.filename.textContent = file.name;
  showLoading('写真を読み込んでいます…');

  let settled = false;
  // EXIF解析が固まった/失敗した場合でも永久に「読み込み中」のままにならないための保険
  const failSafeTimer = setTimeout(() => {
    if (settled) return;
    settled = true;
    hideLoading();
    toast('読み込みに時間がかかっています。別の写真(JPEG/PNGなど)でお試しください');
  }, 8000);

  const url = URL.createObjectURL(file);
  const img = new Image();

  const finish = exifData => {
    if (settled) return;
    settled = true;
    clearTimeout(failSafeTimer);
    URL.revokeObjectURL(url);
    state.exifData = exifData;
    buildOriginalBase(img, exifData);
    onImageReady();
    hideLoading();
  };

  img.onload = () => {
    // 写真の表示はEXIF読み取りの成否に左右させない(HEIC等でEXIF解析が失敗/停止しても写真は表示する)
    loadScriptOnce(EXIFJS_URL)
      .then(() => {
        patchExifTags();
        try {
          EXIF.getData(file, function () { finish(this.exifdata || null); });
        } catch (err) {
          console.warn('EXIF読み取りに失敗しました(写真の表示は続行します)', err);
          finish(null);
        }
      })
      .catch(err => {
        console.warn('EXIFライブラリを読み込めませんでした(写真の表示は続行します)', err);
        finish(null);
      });
  };
  img.onerror = () => {
    if (settled) return;
    settled = true;
    clearTimeout(failSafeTimer);
    URL.revokeObjectURL(url);
    hideLoading();
    toast('この画像は読み込めませんでした(HEIC形式の場合はJPEG/PNGへの変換をお試しください)');
  };
  img.src = url;
}

function buildOriginalBase(img, exifData) {
  const orientation = exifData && exifData.Orientation ? exifData.Orientation : 1;
  let w = img.naturalWidth, h = img.naturalHeight;

  // 長辺を MAX_EDIT_DIM に収める(端末負荷対策)
  const scale = Math.min(1, MAX_EDIT_DIM / Math.max(w, h));
  const dw = Math.round(w * scale), dh = Math.round(h * scale);

  const swap = orientation >= 5 && orientation <= 8; // 90度回転系
  const c = document.createElement('canvas');
  c.width = swap ? dh : dw;
  c.height = swap ? dw : dh;
  const cctx = c.getContext('2d');

  cctx.save();
  switch (orientation) {
    case 2: cctx.transform(-1, 0, 0, 1, c.width, 0); break;
    case 3: cctx.transform(-1, 0, 0, -1, c.width, c.height); break;
    case 4: cctx.transform(1, 0, 0, -1, 0, c.height); break;
    case 5: cctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: cctx.transform(0, 1, -1, 0, c.width, 0); break;
    case 7: cctx.transform(0, -1, -1, 0, c.width, c.height); break;
    case 8: cctx.transform(0, -1, 1, 0, 0, c.height); break;
    default: break; // 1: 補正不要
  }
  cctx.drawImage(img, 0, 0, dw, dh);
  cctx.restore();

  state.originalBase = c;
}

function onImageReady() {
  els.pickerScreen.hidden = true;
  els.editorScreen.hidden = false;
  els.btnSave.disabled = false;

  state.appliedCropRect = null;
  state.workingBase = cloneCanvas(state.originalBase);
  state.hideRegions = [];
  resetExifSettings();
  buildExifFieldChips();

  setMode('crop');
  resetCropToAspect('free');
  preloadFaceModel();
}

function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

/* ========================================================================
   2. モード切替(トリミング / EXIF / 隠す)
   ======================================================================== */
$$('.tab-btn').forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));

function setMode(mode) {
  // トリミング編集中に他タブへ移動する場合は破棄してキャンセル扱い
  if (state.mode === 'crop' && mode !== 'crop') cancelCropEdit();

  state.mode = mode;
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  Object.entries(els.panels).forEach(([k, el]) => el.hidden = k !== mode);

  els.cropOverlay.hidden = mode !== 'crop';
  els.hideOverlay.hidden = mode !== 'hide';
  els.canvasHint.hidden = true;

  if (mode === 'crop') {
    els.canvasHint.hidden = false;
    els.canvasHint.textContent = '指で移動・ピンチで拡大縮小できます';
    renderCropPreview();
  } else {
    renderFinal();
    if (mode === 'hide') syncHideOverlay();
  }
}

/* ========================================================================
   3. トリミング
   ======================================================================== */
function resetCropToAspect(aspectKey) {
  const base = state.originalBase;
  state.crop.aspect = aspectKey;

  let ratio = null;
  if (aspectKey === '1:1') ratio = 1;
  else if (aspectKey === '4:3') ratio = 4 / 3;
  else if (aspectKey === '3:4') ratio = 3 / 4;
  else if (aspectKey === '16:9') ratio = 16 / 9;
  else if (aspectKey === '9:16') ratio = 9 / 16;
  else if (aspectKey === 'orig') ratio = base.width / base.height;
  // 'free' -> ratio = null (画像全体をそのまま使う)

  let w, h;
  if (ratio === null) { w = base.width; h = base.height; }
  else if (base.width / base.height > ratio) { h = base.height; w = h * ratio; }
  else { w = base.width; h = w / ratio; }

  state.crop.srcW = w;
  state.crop.srcH = h;
  state.crop.srcX = (base.width - w) / 2;
  state.crop.srcY = (base.height - h) / 2;

  $$('#panel-crop .chip').forEach(c => c.classList.toggle('active', c.dataset.aspect === aspectKey));
  renderCropPreview();
}

$$('#panel-crop .chip').forEach(chip => {
  chip.addEventListener('click', () => resetCropToAspect(chip.dataset.aspect));
});

function renderCropPreview() {
  const { srcX, srcY, srcW, srcH } = state.crop;
  const targetW = 900, targetH = Math.round(900 * (srcH / srcW));
  els.canvas.width = targetW;
  els.canvas.height = Math.max(1, targetH);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(state.originalBase, srcX, srcY, srcW, srcH, 0, 0, els.canvas.width, els.canvas.height);
  els.cropFrame.style.left = '4%';
  els.cropFrame.style.top = '4%';
  els.cropFrame.style.right = '4%';
  els.cropFrame.style.bottom = '4%';
}

/* --- パン(ドラッグ)/ ピンチズーム --- */
let pointers = new Map();
let pinchStartDist = 0, pinchStartRect = null;

els.canvasWrap.addEventListener('pointerdown', e => {
  if (state.mode !== 'crop') return;
  els.canvasWrap.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    pinchStartRect = { ...state.crop };
  }
});
els.canvasWrap.addEventListener('pointermove', e => {
  if (state.mode !== 'crop' || !pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId);
  const cur = { x: e.clientX, y: e.clientY };
  pointers.set(e.pointerId, cur);

  if (pointers.size === 1) {
    const rect = els.canvas.getBoundingClientRect();
    const scale = state.crop.srcW / rect.width;
    const dxImg = (cur.x - prev.x) * scale;
    const dyImg = (cur.y - prev.y) * scale;
    panCrop(-dxImg, -dyImg);
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const factor = dist / pinchStartDist;
    zoomCrop(pinchStartRect, factor);
  }
});
function endPointer(e) { pointers.delete(e.pointerId); }
els.canvasWrap.addEventListener('pointerup', endPointer);
els.canvasWrap.addEventListener('pointercancel', endPointer);
els.canvasWrap.addEventListener('pointerleave', endPointer);

function panCrop(dx, dy) {
  const base = state.originalBase;
  state.crop.srcX = clamp(state.crop.srcX + dx, 0, base.width - state.crop.srcW);
  state.crop.srcY = clamp(state.crop.srcY + dy, 0, base.height - state.crop.srcH);
  renderCropPreview();
}

function zoomCrop(startRect, factor) {
  const base = state.originalBase;
  const cx = startRect.srcX + startRect.srcW / 2;
  const cy = startRect.srcY + startRect.srcH / 2;
  const minW = 40, maxW = base.width;
  let w = clamp(startRect.srcW / factor, minW, maxW);
  let h = w * (startRect.srcH / startRect.srcW);
  if (h > base.height) { h = base.height; w = h * (startRect.srcW / startRect.srcH); }

  state.crop.srcW = w; state.crop.srcH = h;
  state.crop.srcX = clamp(cx - w / 2, 0, base.width - w);
  state.crop.srcY = clamp(cy - h / 2, 0, base.height - h);
  renderCropPreview();
}

els.cropApply.addEventListener('click', () => {
  const { srcX, srcY, srcW, srcH } = state.crop;
  const c = document.createElement('canvas');
  c.width = Math.round(srcW);
  c.height = Math.round(srcH);
  c.getContext('2d').drawImage(state.originalBase, srcX, srcY, srcW, srcH, 0, 0, c.width, c.height);
  state.workingBase = c;
  state.appliedCropRect = { srcX, srcY, srcW, srcH };
  // クロップ確定でクロップ後座標系が変わるため、隠す領域はリセット(検出しなおし)
  state.hideRegions = [];
  toast('トリミングを適用しました');
  setMode('exif');
});

els.cropCancel.addEventListener('click', () => { cancelCropEdit(); setMode(state.appliedCropRect ? 'exif' : 'crop'); });

function cancelCropEdit() {
  if (state.appliedCropRect) {
    const r = state.appliedCropRect;
    state.crop.srcX = r.srcX; state.crop.srcY = r.srcY; state.crop.srcW = r.srcW; state.crop.srcH = r.srcH;
  } else {
    resetCropToAspect('free');
  }
}

/* ========================================================================
   4. EXIF 焼き込み
   ======================================================================== */
const EXIF_FIELD_DEFS = [
  { key: 'datetime', label: '撮影日時', get: d => formatExifDate(d.DateTimeOriginal || d.DateTime) },
  { key: 'make',     label: 'カメラメーカー', get: d => d.Make },
  { key: 'model',    label: 'カメラ機種', get: d => d.Model },
  { key: 'lens',     label: 'レンズ', get: d => d.LensModel },
  { key: 'focal',    label: '焦点距離', get: d => d.FocalLength ? `${Math.round(toNum(d.FocalLength))}mm` : null },
  { key: 'fnumber',  label: 'F値', get: d => d.FNumber ? `F${toNum(d.FNumber)}` : null },
  { key: 'shutter',  label: 'シャッタースピード', get: d => formatShutter(d.ExposureTime) },
  { key: 'iso',      label: 'ISO', get: d => d.ISOSpeedRatings ? `ISO${d.ISOSpeedRatings}` : null },
  { key: 'gps',      label: 'GPS情報', get: d => formatGps(d), defaultOn: false },
];

// exif-js 2.3.0 は EXIF 2.3 で追加されたレンズ関連タグを認識しないため、読み込み後に補完する
function patchExifTags() {
  if (!window.EXIF || !EXIF.Tags || EXIF.Tags[0xA434]) return;
  Object.assign(EXIF.Tags, {
    0xA430: 'CameraOwnerName',
    0xA431: 'BodySerialNumber',
    0xA432: 'LensSpecification',
    0xA433: 'LensMake',
    0xA434: 'LensModel',
    0xA435: 'LensSerialNumber',
  });
}

function toNum(v) { return typeof v === 'object' && v.numerator != null ? v.numerator / v.denominator : v; }
function formatExifDate(v) {
  if (!v) return null;
  // EXIF形式 "2026:09:03 18:42:00"
  const m = String(v).match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/);
  return m ? `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}` : v;
}
function formatShutter(v) {
  if (!v) return null;
  const n = toNum(v);
  if (n >= 1) return `${n}s`;
  return `1/${Math.round(1 / n)}s`;
}
function formatGps(d) {
  if (!d.GPSLatitude || !d.GPSLongitude) return null;
  const toDeg = (arr, ref) => {
    const val = arr[0] + arr[1] / 60 + arr[2] / 3600;
    return (ref === 'S' || ref === 'W') ? -val : val;
  };
  const lat = toDeg(d.GPSLatitude.map(toNum), d.GPSLatitudeRef);
  const lon = toDeg(d.GPSLongitude.map(toNum), d.GPSLongitudeRef);
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function resetExifSettings() {
  state.exif = { fields: {}, position: 'left', size: 26, color: '#ffffff', colorPreset: 'white', outline: 'white-black' };
  EXIF_FIELD_DEFS.forEach(f => { state.exif.fields[f.key] = f.defaultOn === false ? false : availableExifValue(f) !== null; });
}

function availableExifValue(fieldDef) {
  if (!state.exifData) return null;
  try { return fieldDef.get(state.exifData) || null; } catch { return null; }
}

function buildExifFieldChips() {
  els.exifFields.innerHTML = '';
  const any = EXIF_FIELD_DEFS.some(f => availableExifValue(f) !== null);
  els.exifEmpty.hidden = any;

  EXIF_FIELD_DEFS.forEach(f => {
    const val = availableExifValue(f);
    const chip = document.createElement('button');
    chip.className = 'toggle-chip' + (state.exif.fields[f.key] && val !== null ? ' active' : '');
    chip.textContent = f.label;
    chip.disabled = val === null;
    chip.style.opacity = val === null ? .35 : 1;
    chip.addEventListener('click', () => {
      state.exif.fields[f.key] = !state.exif.fields[f.key];
      chip.classList.toggle('active', state.exif.fields[f.key]);
      renderFinal();
    });
    els.exifFields.appendChild(chip);
  });
}

els.exifPos.addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  state.exif.position = btn.dataset.pos;
  $$('button', els.exifPos).forEach(b => b.classList.toggle('active', b === btn));
  renderFinal();
});
els.exifSize.addEventListener('input', () => { state.exif.size = +els.exifSize.value; renderFinal(); });
els.exifColor.addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  state.exif.colorPreset = btn.dataset.color;
  state.exif.color = btn.dataset.color === 'white' ? '#ffffff' : '#000000';
  els.exifColorCustom.value = state.exif.color;
  $$('button', els.exifColor).forEach(b => b.classList.toggle('active', b === btn));
  renderFinal();
});
els.exifColorCustom.addEventListener('input', () => {
  state.exif.color = els.exifColorCustom.value;
  state.exif.colorPreset = 'custom';
  $$('button', els.exifColor).forEach(b => b.classList.remove('active'));
  renderFinal();
});
els.exifOutline.addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  state.exif.outline = btn.dataset.outline;
  $$('button', els.exifOutline).forEach(b => b.classList.toggle('active', b === btn));
  renderFinal();
});

function buildExifLines() {
  const lines = [];
  const dt = state.exif.fields.datetime ? availableExifValue(EXIF_FIELD_DEFS[0]) : null;
  if (dt) lines.push(dt);

  const camParts = [];
  if (state.exif.fields.make) { const v = availableExifValue(EXIF_FIELD_DEFS[1]); if (v) camParts.push(v); }
  if (state.exif.fields.model) { const v = availableExifValue(EXIF_FIELD_DEFS[2]); if (v) camParts.push(v); }
  if (camParts.length) lines.push(camParts.join(' '));

  if (state.exif.fields.lens) { const v = availableExifValue(EXIF_FIELD_DEFS[3]); if (v) lines.push(v); }

  const shootParts = [];
  ['focal', 'fnumber', 'shutter', 'iso'].forEach((key, i) => {
    if (state.exif.fields[key]) {
      const def = EXIF_FIELD_DEFS.find(f => f.key === key);
      const v = availableExifValue(def);
      if (v) shootParts.push(v);
    }
  });
  if (shootParts.length) lines.push(shootParts.join('  '));

  if (state.exif.fields.gps) { const v = availableExifValue(EXIF_FIELD_DEFS[8]); if (v) lines.push(`GPS ${v}`); }

  return lines;
}

function drawExifText(targetCtx, w, h) {
  const lines = buildExifLines();
  if (!lines.length) return;
  const size = state.exif.size;
  const pad = Math.round(size * 0.9);
  const lineH = size * 1.3;

  targetCtx.font = `600 ${size}px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;
  targetCtx.textBaseline = 'alphabetic';

  const align = state.exif.position; // left | center | right
  targetCtx.textAlign = align;
  const x = align === 'left' ? pad : align === 'right' ? w - pad : w / 2;

  const totalH = lines.length * lineH;
  let y = h - pad - totalH + lineH * 0.8;

  const outline = state.exif.outline;
  lines.forEach(line => {
    if (outline !== 'none') {
      targetCtx.lineWidth = Math.max(2, size * 0.14);
      targetCtx.strokeStyle = outline === 'white-black' ? '#000000' : '#ffffff';
      targetCtx.lineJoin = 'round';
      targetCtx.strokeText(line, x, y);
    }
    targetCtx.fillStyle = state.exif.color;
    targetCtx.fillText(line, x, y);
    y += lineH;
  });
}

/* ========================================================================
   5. 顔・ナンバープレートを隠す
   ======================================================================== */
async function preloadFaceModel() {
  if (state.faceModelReady) return;
  try {
    await loadScriptOnce(FACEAPI_URL);
    if (!window.faceapi) throw new Error('face-api.js の読み込みに失敗しました');
    await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL);
    state.faceModelReady = true;
  } catch (e) {
    console.warn('顔検出モデルの読み込みに失敗しました(通信環境をご確認ください)', e);
  }
}

els.hideDetect.addEventListener('click', runAutoDetect);

async function runAutoDetect() {
  if (state.detecting) return;
  state.detecting = true;
  els.hideStatus.textContent = '顔を検出しています…';
  showLoading('顔を検出しています…');

  try {
    if (!state.faceModelReady) await preloadFaceModel();
    if (!state.faceModelReady) {
      els.hideStatus.textContent = 'モデルを読み込めませんでした。手動で追加してください。';
      return;
    }
    const detections = await faceapi.detectAllFaces(
      state.workingBase,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 })
    );
    // 既存のauto検出結果は入れ替え、手動追加分は残す
    state.hideRegions = state.hideRegions.filter(r => r.source !== 'auto');
    detections.forEach(d => {
      const b = d.box;
      state.hideRegions.push(makeRegion(b.x, b.y, b.width, b.height, 'face', 'auto'));
    });
    els.hideStatus.textContent = detections.length
      ? `顔を${detections.length}件検出しました。タップでON/OFFできます。`
      : '顔は検出されませんでした。ナンバープレートは「＋追加」で範囲を指定してください。';
  } catch (e) {
    console.error(e);
    els.hideStatus.textContent = '検出中にエラーが発生しました。手動で追加してください。';
  } finally {
    state.detecting = false;
    hideLoading();
    syncHideOverlay();
    renderHideList();
    renderFinal();
  }
}

function makeRegion(x, y, w, h, type, source) {
  return { id: regionSeq++, x, y, w, h, type, source, method: state.hideMethod, enabled: true };
}

els.hideMethod.addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  state.hideMethod = btn.dataset.method;
  $$('button', els.hideMethod).forEach(b => b.classList.toggle('active', b === btn));
  // 既に検出/追加済みの範囲にも新しい隠し方を反映する
  state.hideRegions.forEach(r => { r.method = state.hideMethod; });
  renderFinal();
});

/* --- 手動追加(ドラッグして範囲指定) --- */
let manualAddMode = false;
let manualDragStart = null;
let manualDragBox = null;

els.hideAdd.addEventListener('click', () => {
  manualAddMode = true;
  els.hideStatus.textContent = '写真上をドラッグして隠したい範囲を指定してください';
});

els.canvasWrap.addEventListener('pointerdown', e => {
  if (state.mode !== 'hide' || !manualAddMode) return;
  const p = screenToWorking(e.clientX, e.clientY);
  manualDragStart = p;
});
els.canvasWrap.addEventListener('pointermove', e => {
  if (state.mode !== 'hide' || !manualAddMode || !manualDragStart) return;
  const p = screenToWorking(e.clientX, e.clientY);
  manualDragBox = normBox(manualDragStart, p);
  drawManualBoxPreview(manualDragBox);
});
els.canvasWrap.addEventListener('pointerup', e => {
  if (state.mode !== 'hide' || !manualAddMode || !manualDragStart) return;
  const p = screenToWorking(e.clientX, e.clientY);
  const box = normBox(manualDragStart, p);
  manualDragStart = null; manualDragBox = null;
  manualAddMode = false;
  if (box.w > 8 && box.h > 8) {
    state.hideRegions.push(makeRegion(box.x, box.y, box.w, box.h, 'manual', 'manual'));
    renderHideList(); syncHideOverlay(); renderFinal();
    els.hideStatus.textContent = '範囲を追加しました。タップでON/OFFできます。';
  } else {
    els.hideStatus.textContent = '範囲が小さすぎます。もう一度ドラッグしてください。';
  }
});

function screenToWorking(clientX, clientY) {
  const rect = els.canvas.getBoundingClientRect();
  const scaleX = state.workingBase.width / rect.width;
  const scaleY = state.workingBase.height / rect.height;
  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}
function normBox(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}
function drawManualBoxPreview(box) {
  renderFinal();
  ctx.save();
  ctx.strokeStyle = '#e8a33d'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.restore();
}

/* --- 検出枠オーバーレイ(SVG)の同期 --- */
function syncHideOverlay() {
  const svg = els.hideOverlay;
  if (!state.workingBase) return;
  svg.setAttribute('viewBox', `0 0 ${state.workingBase.width} ${state.workingBase.height}`);
  svg.innerHTML = '';

  state.hideRegions.forEach(r => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', r.x); rect.setAttribute('y', r.y);
    rect.setAttribute('width', r.w); rect.setAttribute('height', r.h);
    rect.setAttribute('rx', 6);
    rect.setAttribute('class', 'det-box' + (r.enabled ? '' : ' off'));
    rect.addEventListener('click', () => {
      r.enabled = !r.enabled;
      syncHideOverlay(); renderHideList(); renderFinal();
    });
    g.appendChild(rect);

    const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const label = r.type === 'face' ? '顔' : r.type === 'plate' ? 'ナンバー' : '指定範囲';
    const lw = label.length * 12 + 10;
    labelBg.setAttribute('x', r.x); labelBg.setAttribute('y', Math.max(0, r.y - 18));
    labelBg.setAttribute('width', lw); labelBg.setAttribute('height', 18);
    labelBg.setAttribute('class', 'det-label-bg');
    g.appendChild(labelBg);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', r.x + 5); text.setAttribute('y', Math.max(13, r.y - 5));
    text.setAttribute('class', 'det-label');
    text.textContent = label;
    g.appendChild(text);

    svg.appendChild(g);
  });
}

function renderHideList() {
  els.hideList.innerHTML = '';
  if (!state.hideRegions.length) {
    els.hideList.innerHTML = '<div class="hint-text">検出・追加された範囲はまだありません</div>';
    return;
  }
  state.hideRegions.forEach(r => {
    const row = document.createElement('div');
    row.className = 'hide-item';
    const label = r.type === 'face' ? '顔' : r.type === 'plate' ? 'ナンバー' : '手動範囲';
    row.innerHTML = `
      <span class="tag ${r.source === 'auto' ? 'auto' : ''}">${r.source === 'auto' ? 'AI検出' : '手動'}</span>
      <span>${label}</span>
      <button data-act="toggle">${r.enabled ? 'ON' : 'OFF'}</button>
      <button data-act="del" class="del">削除</button>`;
    row.querySelector('[data-act="toggle"]').addEventListener('click', () => {
      r.enabled = !r.enabled; renderHideList(); syncHideOverlay(); renderFinal();
    });
    row.querySelector('[data-act="del"]').addEventListener('click', () => {
      state.hideRegions = state.hideRegions.filter(x => x.id !== r.id);
      renderHideList(); syncHideOverlay(); renderFinal();
    });
    els.hideList.appendChild(row);
  });
}

/* --- モザイク / アイコン適用 --- */
function applyHideRegions(targetCtx, sourceCanvas) {
  state.hideRegions.filter(r => r.enabled).forEach(r => {
    const x = clamp(r.x, 0, sourceCanvas.width - 1);
    const y = clamp(r.y, 0, sourceCanvas.height - 1);
    const w = clamp(r.w, 1, sourceCanvas.width - x);
    const h = clamp(r.h, 1, sourceCanvas.height - y);
    if (r.method === 'mosaic') drawMosaic(targetCtx, sourceCanvas, x, y, w, h);
    else drawIcon(targetCtx, x, y, w, h);
  });
}

function drawMosaic(targetCtx, sourceCanvas, x, y, w, h) {
  const blocks = 10; // 分割数(小さいほど粗い=隠れる)
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(blocks));
  small.height = Math.max(1, Math.round(blocks * (h / w)) || blocks);
  const sctx = small.getContext('2d');
  sctx.drawImage(sourceCanvas, x, y, w, h, 0, 0, small.width, small.height);

  targetCtx.save();
  targetCtx.imageSmoothingEnabled = false;
  targetCtx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h);
  targetCtx.restore();
}

function drawIcon(targetCtx, x, y, w, h) {
  targetCtx.save();
  targetCtx.fillStyle = '#1a1d21';
  roundRect(targetCtx, x, y, w, h, Math.min(w, h) * 0.15);
  targetCtx.fill();
  targetCtx.font = `${Math.min(w, h) * 0.75}px sans-serif`;
  targetCtx.textAlign = 'center';
  targetCtx.textBaseline = 'middle';
  targetCtx.fillText('🕶️', x + w / 2, y + h / 2 + h * 0.03);
  targetCtx.restore();
}
function roundRect(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/* ========================================================================
   6. 最終合成レンダリング(トリミング以外のモードで使用)
   ======================================================================== */
function renderFinal() {
  if (!state.workingBase) return;
  els.canvas.width = state.workingBase.width;
  els.canvas.height = state.workingBase.height;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(state.workingBase, 0, 0);
  drawExifText(ctx, els.canvas.width, els.canvas.height);
  applyHideRegions(ctx, state.workingBase);
  syncOverlayGeometry();
}

function syncOverlayGeometry() {
  // SVGオーバーレイをcanvasの表示矩形にぴったり合わせる
  requestAnimationFrame(() => {
    const rect = els.canvas.getBoundingClientRect();
    const wrapRect = els.canvasWrap.getBoundingClientRect();
    const style = { left: `${rect.left - wrapRect.left}px`, top: `${rect.top - wrapRect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` };
    Object.assign(els.hideOverlay.style, style);
  });
}
window.addEventListener('resize', syncOverlayGeometry);

/* ========================================================================
   7. リセット / 保存
   ======================================================================== */
els.btnReset.addEventListener('click', () => {
  if (!state.originalBase) return;
  if (!confirm('すべての編集内容を破棄して元の写真に戻します。よろしいですか？')) return;
  state.appliedCropRect = null;
  state.workingBase = cloneCanvas(state.originalBase);
  state.hideRegions = [];
  resetExifSettings();
  buildExifFieldChips();
  setMode('crop');
  resetCropToAspect('free');
  toast('リセットしました');
});

els.btnSave.addEventListener('click', () => {
  if (!state.workingBase) return;
  const out = document.createElement('canvas');
  out.width = state.workingBase.width;
  out.height = state.workingBase.height;
  const octx = out.getContext('2d');
  octx.drawImage(state.workingBase, 0, 0);
  drawExifText(octx, out.width, out.height);
  applyHideRegions(octx, state.workingBase);

  out.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    a.href = url;
    a.download = `edited_${stamp}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('保存しました(端末のダウンロード/写真に追加されます)');
  }, 'image/jpeg', 0.92);
});

/* ---------- 想定外エラーへの保険: ローディング表示が固まったままにならないようにする ---------- */
window.addEventListener('error', e => { console.error(e.error || e.message); hideLoading(); });
window.addEventListener('unhandledrejection', e => { console.error(e.reason); hideLoading(); });

/* ---------- PWA: Service Worker(任意・オフライン対応) ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

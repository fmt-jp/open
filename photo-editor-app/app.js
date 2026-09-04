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
  btnClosePhoto: $('#btn-close-photo'),
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
  exifApply:  $('#exif-apply'),
  exifCancel: $('#exif-cancel'),
  exifDisableAll: $('#exif-disable-all'),
  hideStatus: $('#hide-status'),
  hideDetect: $('#hide-detect'),
  hideAdd:    $('#hide-add'),
  hideMethod: $('#hide-method'),
  hideIconRow: $('#hide-icon-row'),
  hideIconChoice: $('#hide-icon-choice'),
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
  crop: {                 // 現在のクロップ枠の設定。座標は originalBase 基準
    aspect: 'free',
  },
  cropFrame: { x: 0, y: 0, w: 0, h: 0 }, // 現在(未適用含む)のクロップ枠。originalBase基準
  appliedCropRect: null,  // 直近に「適用」されたクロップ範囲(originalBase基準+aspect)。nullなら全体
  workingBase: null,      // canvas: クロップ確定後の画像(EXIF/隠す処理の土台)
  exif: {                 // 焼き込み設定
    fields: {},           // { datetime:true, make:false, ... }
    position: 'left',
    size: 26,
    color: '#ffffff',
    colorPreset: 'white',
    outline: 'white-black',
  },
  hideRegions: [],         // { id, x,y,w,h (workingBase基準), type:'face'|'plate'|'manual', method:'mosaic'|'icon', icon, enabled }
  hideMethod: 'mosaic',
  hideIcon: 'sunglasses',
  faceModelReady: false,
  detecting: false,
};

let regionSeq = 1;
let cropSnapshot = null;   // クロップタブに入った時点の枠(キャンセルで復元)
let exifSnapshot = null;   // EXIFタブに入った時点の設定(キャンセルで復元)

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

  state.cropFrame = { x: 0, y: 0, w: state.originalBase.width, h: state.originalBase.height };
  state.crop.aspect = 'free';
  syncAspectChipUI();
  setMode('crop');
  preloadFaceModel();
}

function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

/* ---------- 写真を閉じて別の写真を選び直す ---------- */
els.btnClosePhoto.addEventListener('click', () => {
  if (!state.originalBase) return;
  if (!confirm('編集内容は保存されません。別の写真を選び直しますか？')) return;
  goToPicker();
});

function goToPicker() {
  state.originalBase = null;
  state.workingBase = null;
  state.exifData = null;
  state.appliedCropRect = null;
  state.hideRegions = [];
  cropSnapshot = null;
  exifSnapshot = null;
  els.fileInput.value = '';
  els.cameraInput.value = '';
  els.btnSave.disabled = true;
  els.filename.textContent = '写真を選択してください';
  els.editorScreen.hidden = true;
  els.pickerScreen.hidden = false;
}

/* ========================================================================
   2. モード切替(トリミング / EXIF / 隠す)
   ======================================================================== */
$$('.tab-btn').forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));

function setMode(mode) {
  state.mode = mode;
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  Object.entries(els.panels).forEach(([k, el]) => el.hidden = k !== mode);

  els.cropOverlay.hidden = mode !== 'crop';
  els.hideOverlay.hidden = mode !== 'hide';
  els.canvasHint.hidden = true;

  if (mode === 'crop') {
    els.canvasHint.hidden = false;
    els.canvasHint.textContent = '枠をドラッグして移動、ハンドルでサイズを変更できます';
    // クロップタブに入った時点の枠を記憶しておく(「キャンセル」で復元するため)
    cropSnapshot = { ...state.cropFrame };
    renderCropStage();
  } else if (mode === 'exif') {
    // EXIFタブに入った時点の設定を記憶しておく(「キャンセル」で復元するため)
    exifSnapshot = JSON.parse(JSON.stringify(state.exif));
    renderFinal();
  } else {
    renderFinal();
    if (mode === 'hide') syncHideOverlay();
  }
}

/* ========================================================================
   3. トリミング(枠をドラッグ/ハンドルで指定する方式)
   ======================================================================== */
function aspectRatioValue(aspectKey, base) {
  if (aspectKey === '1:1') return 1;
  if (aspectKey === '4:3') return 4 / 3;
  if (aspectKey === '3:4') return 3 / 4;
  if (aspectKey === '16:9') return 16 / 9;
  if (aspectKey === '9:16') return 9 / 16;
  if (aspectKey === 'orig') return base.width / base.height;
  return null; // free
}

function resetCropFrameToAspect(aspectKey) {
  const base = state.originalBase;
  state.crop.aspect = aspectKey;
  const ratio = aspectRatioValue(aspectKey, base);

  let w, h;
  if (ratio === null) { w = base.width; h = base.height; }
  else if (base.width / base.height > ratio) { h = base.height; w = h * ratio; }
  else { w = base.width; h = w / ratio; }

  state.cropFrame = { x: (base.width - w) / 2, y: (base.height - h) / 2, w, h };
  syncAspectChipUI();
  syncCropFrameGeometry();
}

function syncAspectChipUI() {
  $$('#panel-crop .chip').forEach(c => c.classList.toggle('active', c.dataset.aspect === state.crop.aspect));
}

$$('#panel-crop .chip').forEach(chip => {
  chip.addEventListener('click', () => resetCropFrameToAspect(chip.dataset.aspect));
});

function renderCropStage() {
  // クロップモードでは常に写真全体を表示し、その上に枠を重ねて範囲を指定する
  const base = state.originalBase;
  els.canvas.width = base.width;
  els.canvas.height = base.height;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(base, 0, 0);
  syncCropFrameGeometry();
}

function syncCropFrameGeometry() {
  requestAnimationFrame(() => {
    if (state.mode !== 'crop') return;
    const rect = els.canvas.getBoundingClientRect();
    const wrapRect = els.canvasWrap.getBoundingClientRect();
    const base = state.originalBase;
    const scaleX = rect.width / base.width, scaleY = rect.height / base.height;
    const f = state.cropFrame;
    Object.assign(els.cropFrame.style, {
      left:   `${(rect.left - wrapRect.left) + f.x * scaleX}px`,
      top:    `${(rect.top - wrapRect.top) + f.y * scaleY}px`,
      width:  `${f.w * scaleX}px`,
      height: `${f.h * scaleY}px`,
    });
    // アスペクト比が固定されている間は、辺の中央ハンドルは比率を崩すため隠す
    const locked = state.crop.aspect !== 'free';
    $$('.crop-handle', els.cropFrame).forEach(h => {
      h.classList.toggle('hidden-handle', locked && !h.classList.contains('corner'));
    });
  });
}
window.addEventListener('resize', () => { if (state.mode === 'crop') syncCropFrameGeometry(); });

/* --- 枠のドラッグ移動 / ハンドルでのリサイズ --- */
const MIN_CROP_SIZE = 60; // 画像ピクセル基準の最小サイズ
let cropDrag = null; // { type:'move'|'resize', handle, startX, startY, startFrame }

els.cropFrame.addEventListener('pointerdown', e => {
  if (state.mode !== 'crop') return;
  e.preventDefault();
  const handleEl = e.target.closest('.crop-handle');
  cropDrag = {
    type: handleEl ? 'resize' : 'move',
    handle: handleEl ? handleEl.dataset.handle : null,
    startX: e.clientX,
    startY: e.clientY,
    startFrame: { ...state.cropFrame },
  };
});

window.addEventListener('pointermove', e => {
  if (!cropDrag || state.mode !== 'crop') return;
  const rect = els.canvas.getBoundingClientRect();
  const base = state.originalBase;
  const scaleX = base.width / rect.width, scaleY = base.height / rect.height;
  const dx = (e.clientX - cropDrag.startX) * scaleX;
  const dy = (e.clientY - cropDrag.startY) * scaleY;

  if (cropDrag.type === 'move') {
    moveCropFrame(cropDrag.startFrame, dx, dy);
  } else {
    resizeCropFrame(cropDrag.startFrame, cropDrag.handle, dx, dy);
  }
});
window.addEventListener('pointerup', () => { cropDrag = null; });
window.addEventListener('pointercancel', () => { cropDrag = null; });

function moveCropFrame(startFrame, dx, dy) {
  const base = state.originalBase;
  state.cropFrame.x = clamp(startFrame.x + dx, 0, Math.max(0, base.width - startFrame.w));
  state.cropFrame.y = clamp(startFrame.y + dy, 0, Math.max(0, base.height - startFrame.h));
  syncCropFrameGeometry();
}

function resizeCropFrame(startFrame, handle, dx, dy) {
  const base = state.originalBase;
  const ratio = aspectRatioValue(state.crop.aspect, base); // null = 自由
  let { x, y, w, h } = startFrame;
  const x0 = startFrame.x, y0 = startFrame.y, w0 = startFrame.w, h0 = startFrame.h;

  if (handle === 'e') { w = w0 + dx; }
  else if (handle === 'w') { x = x0 + dx; w = w0 - dx; }
  else if (handle === 's') { h = h0 + dy; }
  else if (handle === 'n') { y = y0 + dy; h = h0 - dy; }
  else if (handle === 'se') { w = w0 + dx; h = ratio ? w / ratio : h0 + dy; }
  else if (handle === 'nw') { w = w0 - dx; h = ratio ? w / ratio : h0 - dy; x = x0 + w0 - w; y = y0 + h0 - h; }
  else if (handle === 'ne') { w = w0 + dx; h = ratio ? w / ratio : h0 - dy; y = y0 + h0 - h; }
  else if (handle === 'sw') { w = w0 - dx; h = ratio ? w / ratio : h0 + dy; x = x0 + w0 - w; }

  // 最小サイズを確保
  if (w < MIN_CROP_SIZE) {
    if (['nw', 'w', 'sw'].includes(handle)) x -= (MIN_CROP_SIZE - w);
    w = MIN_CROP_SIZE;
    if (ratio && ['se', 'nw', 'ne', 'sw'].includes(handle)) h = w / ratio;
  }
  if (h < MIN_CROP_SIZE) {
    if (['n', 'nw', 'ne'].includes(handle)) y -= (MIN_CROP_SIZE - h);
    h = MIN_CROP_SIZE;
    if (ratio && ['se', 'nw', 'ne', 'sw'].includes(handle)) w = h * ratio;
  }
  // 画像範囲内にクランプ
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }
  if (x + w > base.width) w = base.width - x;
  if (y + h > base.height) h = base.height - y;

  state.cropFrame = { x, y, w: Math.max(MIN_CROP_SIZE, w), h: Math.max(MIN_CROP_SIZE, h) };
  // 手動リサイズで規定の比率と合わなくなったら「自由」扱いに切り替える
  if (!ratio) { state.crop.aspect = 'free'; syncAspectChipUI(); }
  syncCropFrameGeometry();
}

els.cropApply.addEventListener('click', () => {
  const { x, y, w, h } = state.cropFrame;
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  c.getContext('2d').drawImage(state.originalBase, x, y, w, h, 0, 0, c.width, c.height);
  state.workingBase = c;
  state.appliedCropRect = { x, y, w, h, aspect: state.crop.aspect };
  cropSnapshot = { x, y, w, h };
  // クロップ確定でクロップ後座標系が変わるため、隠す領域はリセット(検出しなおし)
  state.hideRegions = [];
  toast('トリミングを適用しました');
  setMode('exif');
});

els.cropCancel.addEventListener('click', () => {
  if (cropSnapshot) {
    state.cropFrame = { ...cropSnapshot };
    state.crop.aspect = state.appliedCropRect ? state.appliedCropRect.aspect : 'free';
  } else {
    resetCropFrameToAspect('free');
  }
  syncAspectChipUI();
  syncCropFrameGeometry();
  toast('トリミングの変更をキャンセルしました');
});

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

els.exifDisableAll.addEventListener('click', () => {
  Object.keys(state.exif.fields).forEach(k => { state.exif.fields[k] = false; });
  buildExifFieldChips();
  renderFinal();
  toast('EXIF情報をすべて無効にしました');
});

els.exifApply.addEventListener('click', () => {
  exifSnapshot = JSON.parse(JSON.stringify(state.exif));
  toast('EXIF設定を適用しました');
  setMode('hide');
});

els.exifCancel.addEventListener('click', () => {
  if (exifSnapshot) state.exif = JSON.parse(JSON.stringify(exifSnapshot));
  syncExifControlsFromState();
  renderFinal();
  toast('EXIFの変更をキャンセルしました');
});

function syncExifControlsFromState() {
  // state.exif の内容(キャンセルで復元された値など)をUIへ反映しなおす
  $$('#exif-fields .toggle-chip').forEach((chip, i) => {
    const def = EXIF_FIELD_DEFS[i];
    if (def) chip.classList.toggle('active', !!state.exif.fields[def.key] && availableExifValue(def) !== null);
  });
  $$('button', els.exifPos).forEach(b => b.classList.toggle('active', b.dataset.pos === state.exif.position));
  els.exifSize.value = state.exif.size;
  $$('button', els.exifColor).forEach(b => b.classList.toggle('active', b.dataset.color === state.exif.colorPreset));
  els.exifColorCustom.value = state.exif.color;
  $$('button', els.exifOutline).forEach(b => b.classList.toggle('active', b.dataset.outline === state.exif.outline));
}

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
  return { id: regionSeq++, x, y, w, h, type, source, method: state.hideMethod, icon: state.hideIcon, enabled: true };
}

els.hideMethod.addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  state.hideMethod = btn.dataset.method;
  $$('button', els.hideMethod).forEach(b => b.classList.toggle('active', b === btn));
  els.hideIconRow.hidden = state.hideMethod !== 'icon';
  // 既に検出/追加済みの範囲にも新しい隠し方を反映する
  state.hideRegions.forEach(r => { r.method = state.hideMethod; r.icon = state.hideIcon; });
  renderFinal();
});

els.hideIconChoice.addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  state.hideIcon = btn.dataset.icon;
  $$('button', els.hideIconChoice).forEach(b => b.classList.toggle('active', b === btn));
  state.hideRegions.forEach(r => { r.icon = state.hideIcon; });
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
    else drawIcon(targetCtx, x, y, w, h, r.icon);
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

/* --- 隠す用アイコン(モノトーンの自作ベクター図形。絵文字フォントに依存しない) --- */
const HIDE_ICON_DEFS = {
  sunglasses: { label: 'サングラス', draw: drawIconSunglasses },
  block:      { label: '塗りつぶし', draw: drawIconBlock },
  mute:       { label: '無表情',     draw: drawIconMute },
  mask:       { label: 'マスク',     draw: drawIconMask },
  noentry:    { label: '禁止',       draw: drawIconNoEntry },
  question:   { label: 'はてな',     draw: drawIconQuestion },
};

function drawIconSunglasses(c, x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2, s = Math.min(w, h);
  c.fillStyle = '#f4f6f8'; c.strokeStyle = '#f4f6f8';
  c.lineWidth = s * 0.055; c.lineCap = 'round';
  const lensW = s * 0.32, lensH = s * 0.22, gap = s * 0.10, ly = cy - lensH / 2;
  roundRect(c, cx - gap / 2 - lensW, ly, lensW, lensH, lensH * 0.35); c.fill();
  roundRect(c, cx + gap / 2, ly, lensW, lensH, lensH * 0.35); c.fill();
  c.beginPath(); c.moveTo(cx - gap / 2, cy - lensH * 0.35); c.lineTo(cx + gap / 2, cy - lensH * 0.35); c.stroke();
  c.beginPath(); c.moveTo(cx - gap / 2 - lensW, cy - lensH * 0.1); c.lineTo(cx - gap / 2 - lensW - s * 0.14, cy - lensH * 0.35); c.stroke();
  c.beginPath(); c.moveTo(cx + gap / 2 + lensW, cy - lensH * 0.1); c.lineTo(cx + gap / 2 + lensW + s * 0.14, cy - lensH * 0.35); c.stroke();
}

function drawIconBlock(c, x, y, w, h) {
  const s = Math.min(w, h);
  c.fillStyle = '#f4f6f8';
  roundRect(c, x + w / 2 - s * 0.34, y + h / 2 - s * 0.15, s * 0.68, s * 0.30, s * 0.05);
  c.fill();
}

function drawIconMute(c, x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2, s = Math.min(w, h);
  c.strokeStyle = '#f4f6f8'; c.fillStyle = '#f4f6f8';
  c.lineWidth = s * 0.06; c.lineCap = 'round';
  c.beginPath(); c.arc(cx, cy, s * 0.32, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.arc(cx - s * 0.11, cy - s * 0.06, s * 0.035, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(cx + s * 0.11, cy - s * 0.06, s * 0.035, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.moveTo(cx - s * 0.12, cy + s * 0.13); c.lineTo(cx + s * 0.12, cy + s * 0.13); c.stroke();
}

function drawIconMask(c, x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2, s = Math.min(w, h);
  c.fillStyle = '#f4f6f8';
  const mw = s * 0.62, mh = s * 0.36;
  roundRect(c, cx - mw / 2, cy - mh / 2, mw, mh, mh * 0.45);
  c.fill();
  c.strokeStyle = 'rgba(20,23,26,.55)'; c.lineWidth = s * 0.02;
  c.beginPath();
  for (let i = 1; i <= 2; i++) {
    const ly = cy - mh / 2 + mh * (i / 3);
    c.moveTo(cx - mw / 2 + mw * 0.1, ly); c.lineTo(cx + mw / 2 - mw * 0.1, ly);
  }
  c.stroke();
}

function drawIconNoEntry(c, x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2, s = Math.min(w, h);
  c.strokeStyle = '#f4f6f8'; c.lineWidth = s * 0.09; c.lineCap = 'round';
  c.beginPath(); c.arc(cx, cy, s * 0.32, 0, Math.PI * 2); c.stroke();
  const r = s * 0.32 * 0.7;
  c.beginPath(); c.moveTo(cx - r, cy - r); c.lineTo(cx + r, cy + r); c.stroke();
}

function drawIconQuestion(c, x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2, s = Math.min(w, h);
  c.fillStyle = '#f4f6f8';
  c.font = `700 ${Math.round(s * 0.55)}px -apple-system, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('?', cx, cy + s * 0.03);
}

// アイコン選択パレットのミニプレビューを描画(絵文字ではなく上記のベクター図形を使う)
function paintIconChoicePreviews() {
  $$('#hide-icon-choice canvas').forEach(cv => {
    const key = cv.closest('button').dataset.icon;
    const pctx = cv.getContext('2d');
    pctx.clearRect(0, 0, cv.width, cv.height);
    pctx.fillStyle = '#1c2024';
    roundRect(pctx, 0, 0, cv.width, cv.height, 6);
    pctx.fill();
    (HIDE_ICON_DEFS[key] || HIDE_ICON_DEFS.sunglasses).draw(pctx, 0, 0, cv.width, cv.height);
  });
}
paintIconChoicePreviews();

function drawIcon(targetCtx, x, y, w, h, iconKey) {
  targetCtx.save();
  targetCtx.fillStyle = '#14171a';
  roundRect(targetCtx, x, y, w, h, Math.min(w, h) * 0.15);
  targetCtx.fill();
  const def = HIDE_ICON_DEFS[iconKey] || HIDE_ICON_DEFS.sunglasses;
  def.draw(targetCtx, x, y, w, h);
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
  state.hideMethod = 'mosaic';
  state.hideIcon = 'sunglasses';
  $$('button', els.hideMethod).forEach(b => b.classList.toggle('active', b.dataset.method === 'mosaic'));
  $$('button', els.hideIconChoice).forEach(b => b.classList.toggle('active', b.dataset.icon === 'sunglasses'));
  els.hideIconRow.hidden = true;
  resetExifSettings();
  buildExifFieldChips();
  resetCropFrameToAspect('free');
  setMode('crop');
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

/* ---------- Service Worker: 過去の古いキャッシュが残っている端末のためだけに後始末する ----------
   このアプリは今後 Service Worker によるキャッシュを使わない(キャッシュの固着で表示が更新
   されない問題が繰り返し発生したため)。sw.js は自己解除するだけの内容にしてあり、
   既に登録されてしまっている端末からは自動的に消える。新規訪問者には登録しない。 */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => reg.unregister());
  });
}

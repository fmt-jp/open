// ---------------------------------------------------------------------------
// チャート分析モジュール
//
// 365FX のチャート画面のスクリーンショットから、表示されている期間の高値・安値を
// 読み取る。価格データの提供元は API キーを必要とするものしか残っていないため、
// 画面そのものを読む方式にしている。
//
// 色を決め打ちにしないのが要点。Android のスクリーンショットにはカラープロファイル
// が埋め込まれており、ブラウザは表示時にこれを適用するため、画素値は端末や環境で
// 変わる。そこでローソク足の色は毎回画像から学習する。
// ---------------------------------------------------------------------------
const Analyze = (() => {
  "use strict";

  const BASE_W    = 864;
  const TF_BOX    = { x: 336, y: 256, w: 154, h: 76 };     // 足種ボタン
  const PLOT      = { x0: 0, y0: 340, x1: 588, y1: 1300 }; // ローソク足の描画領域
  const LABEL_X   = { x0: 590, x1: 742 };                  // 価格軸ラベルの帯
  const TF_TOL    = 0.045;  // 足種ボタンの一致判定（明暗パターンの平均差）
  const COLOR_TOL = 45;     // 学習した色との一致幅（緩めると移動平均線を誤検出する）
  const SEP_MIN   = 100;    // 陽線と陰線として別物とみなす色の隔たり
  const OFFSET_KEY = "fx_life_chart_offset";
  const BASIS_KEY  = "fx_life_chart_basis";

  const TF_REF_1H = "data:image/png;base64,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";

  const st = {
    offset: 0.03, basis: "wick",
    result: null, busy: false, manualLow: null,
    progress: 0, progressLabel: "", fatal: null,
  };
  try {
    const o = localStorage.getItem(OFFSET_KEY);
    if (o !== null && isFinite(parseFloat(o))) st.offset = parseFloat(o);
    const b = localStorage.getItem(BASIS_KEY);
    if (b === "wick" || b === "body") st.basis = b;
  } catch {}

  const px3 = (v) => v.toFixed(3);

  function loadImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("画像を読み込めません")); };
      img.src = url;
    });
  }

  // 端末ごとの解像度差を吸収するため、横幅 864px に揃える
  function normalise(img) {
    const scale = BASE_W / img.naturalWidth;
    const c = document.createElement("canvas");
    c.width = BASE_W;
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function crop(canvas, x, y, w, h, zoom = 1) {
    const c = document.createElement("canvas");
    c.width = w * zoom; c.height = h * zoom;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = zoom !== 1;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, x, y, w, h, 0, 0, c.width, c.height);
    return c;
  }

  // 画像の色はカラープロファイルや端末で変わる。明暗の形だけを取り出して比べる
  function signature(canvas, x, y, w, h) {
    const c = document.createElement("canvas");
    c.width = 38; c.height = 19;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, x, y, w, h, 0, 0, 38, 19);
    const d = ctx.getImageData(0, 0, 38, 19).data;
    const g = new Float32Array(38 * 19);
    let lo = 255, hi = 0;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const v = (d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114);
      g[p] = v; if (v < lo) lo = v; if (v > hi) hi = v;
    }
    const range = Math.max(hi - lo, 1);
    for (let i = 0; i < g.length; i++) g[i] = (g[i] - lo) / range;
    return g;
  }

  async function checkTimeframe(canvas) {
    const ref = await loadImage(await (await fetch(TF_REF_1H)).blob());
    const rc = document.createElement("canvas");
    rc.width = TF_BOX.w; rc.height = TF_BOX.h;
    rc.getContext("2d").drawImage(ref, 0, 0, TF_BOX.w, TF_BOX.h);

    const a = signature(canvas, TF_BOX.x, TF_BOX.y, TF_BOX.w, TF_BOX.h);
    const b = signature(rc, 0, 0, TF_BOX.w, TF_BOX.h);
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  }

  async function calibrate(canvas, onProgress) {
    const h = PLOT.y1 - PLOT.y0;
    const zoom = 4;
    const strip = crop(canvas, LABEL_X.x0, PLOT.y0, LABEL_X.x1 - LABEL_X.x0, h, zoom);

    const { data } = await Tesseract.recognize(strip, "eng", {
      tessedit_pageseg_mode: 6,
      tessedit_char_whitelist: "0123456789.",
      logger: (m) => { if (typeof m.progress === "number") onProgress(m.progress); },
    }, { blocks: true, text: true });

    const pts = [];
    for (const w of collectWords(data)) {
      const t = (w.text || "").trim();
      if (!/^\d{2,3}\.\d{3}$/.test(t)) continue;
      const price = parseFloat(t);
      if (!isFinite(price) || price < 20 || price > 400) continue;
      pts.push({ y: PLOT.y0 + (w.bbox.y0 + w.bbox.y1) / 2 / zoom, price });
    }
    if (pts.length < 3) return { ok: false, reason: "価格軸の目盛を3つ以上読み取れませんでした。" };

    // 直線をあてはめ、外れた点(誤読)を落としてからもう一度あてはめる
    let fit = lineFit(pts);
    const kept = pts.filter((p) => Math.abs(fit.at(p.y) - p.price) <= 0.02);
    const dropped = pts.length - kept.length;
    if (kept.length < 3) return { ok: false, reason: "読み取った目盛が直線に乗りませんでした。" };
    fit = lineFit(kept);

    const resid = Math.max(...kept.map((p) => Math.abs(fit.at(p.y) - p.price)));
    if (resid > 0.02) return { ok: false, reason: "目盛の読み取りが安定しませんでした。" };
    if (fit.slope >= 0) return { ok: false, reason: "価格軸の向きを判定できませんでした。" };

    return { ok: true, at: fit.at, yenPerPx: -fit.slope, used: kept.length, dropped, resid };
  }

  // tesseract.js は版によって words を直に返したり blocks の奥に持ったりする
  function collectWords(data) {
    if (Array.isArray(data.words) && data.words.length) return data.words;
    const words = [];
    for (const block of (data.blocks || [])) {
      for (const para of (block.paragraphs || [])) {
        for (const line of (para.lines || [])) {
          for (const w of (line.words || [])) words.push(w);
        }
      }
    }
    return words;
  }

  function lineFit(pts) {
    const n = pts.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of pts) { sx += p.y; sy += p.price; sxx += p.y * p.y; sxy += p.y * p.price; }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const inter = (sy - slope * sx) / n;
    return { slope, inter, at: (y) => inter + slope * y };
  }

  // ローソク足の色は端末やカラープロファイルで変わるので、画像から学習する。
  // チャート領域で最も多い有彩色の上位2つが陽線と陰線。移動平均線は本数が桁違いに少ない。
  function learnCandleColours(px, w, h) {
    const bins = new Map();
    for (let i = 0, p = 0; i < px.length; i += 4, p++) {
      const r = px[i], g = px[i+1], b = px[i+2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx <= 60 || mx - mn <= 40) continue;          // 黒い背景と無彩色は除く
      const key = ((r >> 3) << 19) | ((g >> 3) << 11) | ((b >> 3) << 3);
      const e = bins.get(key);
      if (e) { e.n++; e.r += r; e.g += g; e.b += b; }
      else bins.set(key, { n: 1, r, g, b });
    }
    const ranked = [...bins.values()].sort((x, y) => y.n - x.n)
      .map((e) => ({ n: e.n, c: [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)] }));

    const picked = [];
    for (const cand of ranked) {
      if (picked.some((p) => dist(p.c, cand.c) < SEP_MIN)) continue;
      picked.push(cand);
      if (picked.length === 2) break;
    }
    return { picked, ranked: ranked.slice(0, 5) };
  }

  function dist(a, b) {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  }

  function findExtremes(canvas) {
    const w = PLOT.x1 - PLOT.x0, h = PLOT.y1 - PLOT.y0;
    const px = canvas.getContext("2d", { willReadFrequently: true })
                     .getImageData(PLOT.x0, PLOT.y0, w, h).data;

    const { picked, ranked } = learnCandleColours(px, w, h);
    if (picked.length < 2) return { ok: false, ranked };
    const cols = picked.map((p) => p.c);

    const body = new Uint8Array(w * h);   // 実体だけ（始値・終値の範囲）
    const all  = new Uint8Array(w * h);   // 実体＋ヒゲ（高値・安値の範囲）
    let bodyCount = 0;
    for (let i = 0, p = 0; i < px.length; i += 4, p++) {
      const r = px[i], g = px[i+1], b = px[i+2];
      const isBody = cols.some((c) =>
        Math.abs(r - c[0]) + Math.abs(g - c[1]) + Math.abs(b - c[2]) < COLOR_TOL);
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const isWick = (r + g + b) / 3 > 195 && mx - mn < 28;
      if (isBody) { body[p] = 1; bodyCount++; }
      if (isBody || isWick) all[p] = 1;
    }

    // 縦に3画素以上つながっているものだけ残す（破線のグリッドを除くため）
    const scan = (mark) => {
      const hit = (y) => {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (mark[p] && mark[p - w] && mark[p + w]) return true;
        }
        return false;
      };
      let top = -1, bot = -1;
      for (let y = 1; y < h - 1; y++) if (hit(y)) { top = y; break; }
      for (let y = h - 2; y > 0; y--) if (hit(y)) { bot = y; break; }
      return top < 0 || bot < 0 ? null : { top: PLOT.y0 + top, bot: PLOT.y0 + bot };
    };

    const wick = scan(all), bodyExt = scan(body);
    if (!wick || !bodyExt) return { ok: false, ranked, bodyCount };
    return { ok: true, wick, body: bodyExt, cols, bodyCount, ranked };
  }

  async function readHeader(canvas) {
    const c = crop(canvas, 0, 190, 740, 56, 3);
    const { data } = await Tesseract.recognize(c, "eng", {
      tessedit_pageseg_mode: 7,
      tessedit_char_whitelist: "OHLC:0123456789. ",
    });
    const nums = (data.text || "").match(/\d{2,3}\.\d{3}/g);
    if (!nums || nums.length < 4) return null;
    const [o, h, l, cl] = nums.slice(0, 4).map(parseFloat);
    return { o, h, l, c: cl };
  }

  // -------------------------------------------------------------------------
  // 実行
  // -------------------------------------------------------------------------
  async function analyse(file) {
    if (st.busy) return;
    st.busy = true; st.result = null; st.manualLow = null; st.fatal = null;
    step(0, "画像を読み込んでいます");

    try {
      const canvas = normalise(await loadImage(file));

      if (await checkTimeframe(canvas) > TF_TOL) {
        return fail("1時間足のチャートではないようです",
          "365FXで足種を「1時間」に切り替えてから撮影し直してください。チャートの配色や表示設定を変更した場合も、この判定に引っかかります。");
      }

      step(0.05, "価格軸を読み取っています");
      const cal = await calibrate(canvas, (p) => step(0.05 + p * 0.7, "価格軸を読み取っています"));
      if (!cal.ok) return fail("価格軸を読み取れませんでした", cal.reason + " 画面全体が写っているか確認してください。");

      step(0.8, "ローソク足をさがしています");
      const ext = findExtremes(canvas);
      if (!ext.ok) {
        const seen = (ext.ranked || []).map((e) =>
          `<span class="swatch-row"><i style="background:rgb(${e.c.join(",")})"></i>rgb(${e.c.join(", ")}) — ${e.n} 画素</span>`
        ).join("");
        return fail("ローソク足が見つかりませんでした",
          "チャートが表示された状態で撮影されているか確認してください。チャート領域で見つかった色は次のとおりです。" + seen);
      }

      step(0.88, "ヘッダーと照合しています");
      let header = null;
      try { header = await readHeader(canvas); } catch {}

      st.result = {
        canvas, cal, header, cols: ext.cols, bodyCount: ext.bodyCount,
        wick: { high: cal.at(ext.wick.top), low: cal.at(ext.wick.bot), topY: ext.wick.top, botY: ext.wick.bot },
        body: { high: cal.at(ext.body.top), low: cal.at(ext.body.bot), topY: ext.body.top, botY: ext.body.bot },
      };
      st.busy = false;
      render();
    } catch (err) {
      fail("読み取りに失敗しました", String((err && err.message) || err));
    }
  }

  function step(p, label) { st.progress = p; st.progressLabel = label; render(); }
  function fail(title, body) { st.busy = false; st.fatal = { title, body }; render(); }

  // 価格から画素位置を逆算する
  function yOf(price) {
    const a = st.result.cal.at(0), b = st.result.cal.at(1000);
    return (price - a) / ((b - a) / 1000);
  }

  // -------------------------------------------------------------------------
  // 表示
  // -------------------------------------------------------------------------
  function view() {
    if (st.busy) {
      return `<div class="card">
        <div class="ocr-status"><span class="spin">◠</span><span>${st.progressLabel}…</span></div>
        <div class="progress-bar-track" style="margin-top:11px">
          <div class="progress-bar-fill" style="width:${Math.round(st.progress * 100)}%"></div>
        </div>
      </div>` + picker();
    }
    if (st.fatal) {
      return `<div class="error-box"><b>${st.fatal.title}</b><div style="margin-top:4px">${st.fatal.body}</div></div>` + picker();
    }
    if (!st.result) {
      return picker() + `<div class="empty-state">
        <p class="empty-title">スクリーンショットから読み取ります</p>
        <p class="empty-body">365FXで USD/JPY の1時間足を表示し、読み取りたい期間が画面に収まった状態で撮影してください。画面に映っている範囲が、そのまま集計期間になります。</p>
      </div>`;
    }
    return result() + picker();
  }

  function picker() {
    return `<div class="image-drop">
      <div class="image-btn-wrap">
        <div class="image-btn">スクリーンショットを読む</div>
        <input type="file" accept="image/*" class="overlay-file-input" id="analyze-file">
      </div>
    </div>`;
  }

  function result() {
    const r = st.result;
    const base = r[st.basis];
    const low = st.manualLow !== null ? st.manualLow : base.low;
    const dim = (k) => st.basis === k ? "" : " off";

    const checks = [];
    checks.push(`<div>目盛を ${r.cal.used} 個使用${r.cal.dropped ? `（${r.cal.dropped} 個は誤読として除外）` : ""}</div>`);
    checks.push(`<div>目盛のずれ 最大 ${r.cal.resid.toFixed(4)} 円</div>`);
    checks.push(`<div>解像度 1画素 = ${r.cal.yenPerPx.toFixed(4)} 円</div>`);
    checks.push(`<div>ローソク足の色を学習 ${r.cols.map((c) =>
      `<i class="swatch" style="background:rgb(${c.join(",")})"></i>`).join("")}（実体 ${r.bodyCount} 画素）</div>`);

    const nested = r.body.high <= r.wick.high + 0.001 && r.body.low >= r.wick.low - 0.001;
    checks.push(nested ? `<div>実体はヒゲの内側に収まっている</div>`
      : `<div class="ng">実体がヒゲの外に出ています。検出がずれている可能性があります</div>`);

    if (r.header) {
      const range = r.header.h - r.header.l;
      if (range < 0.0005) checks.push(`<div class="ng">最新足の値幅がゼロのため、ヘッダーとの照合は省略</div>`);
      else if (r.header.l < r.wick.low - 0.05 || r.header.h > r.wick.high + 0.05)
        checks.push(`<div class="ng">ヘッダーの四本値と範囲が食い違っています</div>`);
      else checks.push(`<div>ヘッダーの四本値と矛盾なし</div>`);
    }

    return `
      <div class="card">
        <div class="rate-grid">
          <div class="rg-head"></div><div class="rg-head">ヒゲ</div><div class="rg-head">実体</div>
          <div class="rg-k">最高値</div>
          <div class="rg-v neg${dim("wick")}">${px3(r.wick.high)}</div>
          <div class="rg-v neg${dim("body")}">${px3(r.body.high)}</div>
          <div class="rg-k">最安値</div>
          <div class="rg-v pos${dim("wick")}">${px3(r.wick.low)}</div>
          <div class="rg-v pos${dim("body")}">${px3(r.body.low)}</div>
        </div>
        <div class="seg">
          <button class="tab-btn ${st.basis === "wick" ? "active" : ""}" data-basis="wick">ヒゲで見る</button>
          <button class="tab-btn ${st.basis === "body" ? "active" : ""}" data-basis="body">実体で見る</button>
        </div>
        <div class="lead-row">
          <span class="lead-k">最安値 +${st.offset}</span>
          <span class="lead-v">${px3(low + st.offset)}</span>
        </div>
        <div class="input-row" style="margin-top:10px">
          <span class="input-row-label">加算する値</span>
          <span class="input-wrap"><input class="num-input" id="analyze-offset" type="number" step="0.001" min="0" inputmode="decimal" value="${st.offset}"></span>
        </div>
      </div>

      <div class="card">
        <canvas class="preview-canvas" id="analyze-preview"></canvas>
        <p class="image-hint" style="margin-top:9px">実線がヒゲの先端、破線が実体の端です。線がずれている場合は、下で最安値を直接入力できます。</p>
        <div class="input-row" style="margin-top:8px">
          <span class="input-row-label">最安値を手で直す</span>
          <span class="input-wrap"><input class="num-input" id="analyze-low" type="number" step="0.001" inputmode="decimal" value="${px3(low)}"></span>
        </div>
        <div class="checks">${checks.join("")}</div>
      </div>`;
  }

  function drawPreview() {
    const r = st.result;
    const cv = document.getElementById("analyze-preview");
    if (!cv || !r) return;
    const pad = 40;
    const y0 = Math.max(0, r.wick.topY - pad);
    const y1 = Math.min(r.canvas.height, r.wick.botY + pad);
    const cutW = LABEL_X.x1;   // 価格軸のラベルも含めて切り出す
    cv.width = cutW; cv.height = y1 - y0;
    const ctx = cv.getContext("2d");
    ctx.drawImage(r.canvas, 0, y0, cutW, y1 - y0, 0, 0, cv.width, cv.height);

    const low = st.manualLow !== null ? st.manualLow : r[st.basis].low;
    line(r.wick.topY, "#93C5FD", 3, null);
    line(r.body.topY, "#93C5FD", 2, [7, 6]);
    line(r.wick.botY, "#F97A6B", 3, null);
    line(r.body.botY, "#F97A6B", 2, [7, 6]);
    line(yOf(low + st.offset), "#5EEAD4", 3, [11, 7]);

    function line(absY, color, width, dash) {
      const y = absY - y0;
      if (y < 0 || y > cv.height) return;
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = width;
      if (dash) ctx.setLineDash(dash);
      // ラベルの上には引かない。数字が読めなくなるため
      ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(PLOT.x1, y + .5); ctx.stroke();
      ctx.restore();
    }
  }

  // app.js の render() が DOM を作り直した直後に呼ばれる
  function mount() {
    const f = document.getElementById("analyze-file");
    if (f) f.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (file) analyse(file);
    });

    for (const b of document.querySelectorAll(".seg [data-basis]")) {
      b.addEventListener("click", () => {
        st.basis = b.dataset.basis; st.manualLow = null;
        try { localStorage.setItem(BASIS_KEY, st.basis); } catch {}
        render();
      });
    }
    const off = document.getElementById("analyze-offset");
    if (off) off.addEventListener("change", (e) => {
      const v = parseFloat(e.target.value);
      if (isFinite(v) && v >= 0) {
        st.offset = v;
        try { localStorage.setItem(OFFSET_KEY, String(v)); } catch {}
        render();
      }
    });
    const ml = document.getElementById("analyze-low");
    if (ml) ml.addEventListener("change", (e) => {
      const v = parseFloat(e.target.value);
      if (isFinite(v)) { st.manualLow = v; render(); }
    });

    drawPreview();
  }

  return { view, mount };
})();

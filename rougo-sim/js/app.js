/* ==========================================================================
   老後資金シミュレーター — アプリ本体
   すべての金額は「万円」単位で扱う。
   ========================================================================== */

(function(){
  "use strict";

  const STORAGE_KEY = "rougo-sim-state-v1";
  const SLOT_PREFIX = "rougo-sim-slot-";
  const NUM_SLOTS = 5;

  /* ---------------------------------------------------------------------
     初期状態
     --------------------------------------------------------------------- */
  function defaultState(){
    return {
      basic: {
        currentAge: 56,
        retireAge: 60,
        endAge: 90,
        currentAssets: 4000,
        lumpSum: 2000
      },
      economic: {
        inflation: 2.0,
        returnRate: 2.0
      },
      incomes: [
        { id: uid(), name: "年金", amount: 240, period: "year", n: 5, startAge: 65, endAge: 90 },
        { id: uid(), name: "再雇用 給与", amount: 400, period: "year", n: 5, startAge: 60, endAge: 62 }
      ],
      expenses: [
        { id: uid(), name: "生活費", amount: 30, period: "month", n: 5, startAge: 60, endAge: 90 },
        { id: uid(), name: "旅行", amount: 60, period: "year", n: 5, startAge: 60, endAge: 80 },
        { id: uid(), name: "車の買い替え", amount: 300, period: "everyN", n: 5, startAge: 65, endAge: 85 },
        { id: uid(), name: "車検", amount: 15, period: "everyN", n: 2, startAge: 60, endAge: 90 },
        { id: uid(), name: "住宅修繕", amount: 200, period: "everyN", n: 10, startAge: 60, endAge: 90 },
        { id: uid(), name: "リフォーム", amount: 200, period: "once", n: 5, startAge: 70, endAge: 70 }
      ]
    };
  }

  let state = defaultState();
  let lastResult = null;
  let chartInstance = null;

  function uid(){
    return "id-" + Math.random().toString(36).slice(2, 10);
  }

  /* ---------------------------------------------------------------------
     DOM 参照
     --------------------------------------------------------------------- */
  const el = {
    tabBtnInput: document.getElementById("tabBtn-input"),
    tabBtnResult: document.getElementById("tabBtn-result"),
    panelInput: document.getElementById("panel-input"),
    panelResult: document.getElementById("panel-result"),

    currentAge: document.getElementById("in-currentAge"),
    retireAge: document.getElementById("in-retireAge"),
    endAge: document.getElementById("in-endAge"),
    currentAssets: document.getElementById("in-currentAssets"),
    lumpSum: document.getElementById("in-lumpSum"),
    inflation: document.getElementById("in-inflation"),
    returnRate: document.getElementById("in-returnRate"),

    incomeList: document.getElementById("income-list"),
    expenseList: document.getElementById("expense-list"),
    btnAddIncome: document.getElementById("btn-add-income"),
    btnAddExpense: document.getElementById("btn-add-expense"),

    btnSave: document.getElementById("btn-save"),
    btnLoad: document.getElementById("btn-load"),
    btnReset: document.getElementById("btn-reset"),
    saveStatus: document.getElementById("save-status"),

    globalErrors: document.getElementById("global-errors"),
    btnCalculate: document.getElementById("btn-calculate"),
    btnBack: document.getElementById("btn-back-to-input"),

    depletionBanner: document.getElementById("depletion-banner"),
    summaryGrid: document.getElementById("summary-grid"),
    detailTableBody: document.getElementById("detail-table-body"),
    chartCanvas: document.getElementById("assetChart"),

    tplItemRow: document.getElementById("tpl-item-row"),

    slotModal: document.getElementById("slot-modal"),
    slotModalTitle: document.getElementById("slot-modal-title"),
    slotModalNote: document.getElementById("slot-modal-note"),
    slotList: document.getElementById("slot-list"),
    slotModalCancel: document.getElementById("slot-modal-cancel"),
    slotModalConfirm: document.getElementById("slot-modal-confirm")
  };

  /* ---------------------------------------------------------------------
     基本設定・経済条件 のフォーム ⇄ state
     --------------------------------------------------------------------- */
  function bindBasicFields(){
    const map = [
      [el.currentAge, "basic", "currentAge"],
      [el.retireAge, "basic", "retireAge"],
      [el.endAge, "basic", "endAge"],
      [el.currentAssets, "basic", "currentAssets"],
      [el.lumpSum, "basic", "lumpSum"],
      [el.inflation, "economic", "inflation"],
      [el.returnRate, "economic", "returnRate"]
    ];
    map.forEach(([node, group, key]) => {
      node.addEventListener("input", () => {
        state[group][key] = node.value === "" ? "" : Number(node.value);
      });
    });
  }

  function fillBasicFields(){
    el.currentAge.value = state.basic.currentAge;
    el.retireAge.value = state.basic.retireAge;
    el.endAge.value = state.basic.endAge;
    el.currentAssets.value = state.basic.currentAssets;
    el.lumpSum.value = state.basic.lumpSum;
    el.inflation.value = state.economic.inflation;
    el.returnRate.value = state.economic.returnRate;
  }

  /* ---------------------------------------------------------------------
     収入・支出の行 UI
     --------------------------------------------------------------------- */
  const ONCE_LABEL = { income: "一時収入", expense: "一時支出" };

  function createItemRow(item, kind){
    const frag = el.tplItemRow.content.cloneNode(true);
    const row = frag.querySelector(".item-row");
    row.dataset.id = item.id;
    row.dataset.kind = kind;

    const nameInput = row.querySelector(".f-name");
    const amountInput = row.querySelector(".f-amount");
    const periodSelect = row.querySelector(".f-period");
    const nField = row.querySelector(".field-n");
    const nInput = row.querySelector(".f-n");
    const startInput = row.querySelector(".f-startAge");
    const endField = row.querySelector(".field-age-end");
    const endInput = row.querySelector(".f-endAge");
    const ageSep = row.querySelector(".age-sep");
    const startLabel = row.querySelector(".f-age-start-label");
    const removeBtn = row.querySelector(".btn-remove");
    const errorEl = row.querySelector(".item-error");

    nameInput.value = item.name;
    nameInput.placeholder = kind === "income" ? "例：年金" : "例：生活費";
    amountInput.value = item.amount;
    periodSelect.value = item.period;
    const onceOption = periodSelect.querySelector('option[value="once"]');
    if (onceOption) onceOption.textContent = ONCE_LABEL[kind] || "一時支出";
    nInput.value = item.n;
    startInput.value = item.startAge;
    endInput.value = item.endAge;

    function syncPeriodUI(){
      const p = periodSelect.value;
      const nEnabled = p === "everyN";
      nInput.disabled = !nEnabled;
      nField.classList.toggle("is-disabled", !nEnabled);
      if (p === "once"){
        endField.hidden = true;
        ageSep.hidden = true;
        startLabel.textContent = "発生年齢";
      } else {
        endField.hidden = false;
        ageSep.hidden = false;
        startLabel.textContent = "開始年齢";
      }
    }
    syncPeriodUI();

    function pushToState(){
      const list = kind === "income" ? state.incomes : state.expenses;
      const target = list.find(x => x.id === item.id);
      if (!target) return;
      target.name = nameInput.value;
      target.amount = amountInput.value === "" ? "" : Number(amountInput.value);
      target.period = periodSelect.value;
      target.n = nInput.value === "" ? "" : Number(nInput.value);
      target.startAge = startInput.value === "" ? "" : Number(startInput.value);
      target.endAge = periodSelect.value === "once"
        ? target.startAge
        : (endInput.value === "" ? "" : Number(endInput.value));
    }

    [nameInput, amountInput, nInput, startInput, endInput].forEach(inp => {
      inp.addEventListener("input", () => { pushToState(); clearRowError(row); });
    });
    periodSelect.addEventListener("change", () => {
      syncPeriodUI();
      pushToState();
      clearRowError(row);
    });

    removeBtn.addEventListener("click", () => {
      const list = kind === "income" ? state.incomes : state.expenses;
      const idx = list.findIndex(x => x.id === item.id);
      if (idx >= 0) list.splice(idx, 1);
      row.remove();
    });

    row._errorEl = errorEl;
    return row;
  }

  function clearRowError(row){
    row.classList.remove("has-error");
    row._errorEl.hidden = true;
    row._errorEl.textContent = "";
  }
  function setRowError(row, message){
    row.classList.add("has-error");
    row._errorEl.hidden = false;
    row._errorEl.textContent = message;
  }

  function renderItemList(kind){
    const container = kind === "income" ? el.incomeList : el.expenseList;
    const list = kind === "income" ? state.incomes : state.expenses;
    container.innerHTML = "";
    list.forEach(item => container.appendChild(createItemRow(item, kind)));
  }

  function addItem(kind){
    const list = kind === "income" ? state.incomes : state.expenses;
    const item = {
      id: uid(),
      name: "",
      amount: 0,
      period: "year",
      n: 5,
      startAge: state.basic.currentAge || 60,
      endAge: state.basic.endAge || 90
    };
    list.push(item);
    const container = kind === "income" ? el.incomeList : el.expenseList;
    container.appendChild(createItemRow(item, kind));
  }

  /* ---------------------------------------------------------------------
     バリデーション
     --------------------------------------------------------------------- */
  function validate(){
    const errors = [];
    const b = state.basic;

    if (!isFiniteNum(b.currentAge) || !isFiniteNum(b.retireAge) || !isFiniteNum(b.endAge)){
      errors.push("基本設定の年齢は数値で入力してください。");
    } else {
      if (b.currentAge < 0 || b.retireAge < 0 || b.endAge < 0){
        errors.push("年齢に負の数は入力できません。");
      }
      if (b.currentAge > b.endAge){
        errors.push("試算終了年齢は、現在の年齢より後にしてください。");
      }
      if (b.retireAge < b.currentAge || b.retireAge > b.endAge){
        errors.push("退職年齢は、現在の年齢と試算終了年齢の間にしてください。");
      }
    }
    if (!isFiniteNum(b.currentAssets) || b.currentAssets < 0){
      errors.push("現在の金融資産は0以上の数値で入力してください。");
    }
    if (!isFiniteNum(b.lumpSum) || b.lumpSum < 0){
      errors.push("退職金は0以上の数値で入力してください。");
    }

    // 各項目行
    document.querySelectorAll(".item-row").forEach(row => {
      const id = row.dataset.id;
      const kind = row.dataset.kind;
      const list = kind === "income" ? state.incomes : state.expenses;
      const item = list.find(x => x.id === id);
      if (!item) return;
      clearRowError(row);

      const label = kind === "income" ? "収入" : "支出";
      if (!item.name || !item.name.trim()){
        setRowError(row, `${label}の項目名を入力してください。`);
        errors.push(`未入力の${label}項目があります。`);
        return;
      }
      if (!isFiniteNum(item.amount) || item.amount < 0){
        setRowError(row, "金額は0以上の数値で入力してください。");
        errors.push(`「${item.name}」の金額を確認してください。`);
        return;
      }
      if (item.period === "everyN" && (!isFiniteNum(item.n) || item.n <= 0)){
        setRowError(row, "周期は1年以上の数値で入力してください。");
        errors.push(`「${item.name}」の周期を確認してください。`);
        return;
      }
      if (!isFiniteNum(item.startAge) || (item.period !== "once" && !isFiniteNum(item.endAge))){
        setRowError(row, "年齢を入力してください。");
        errors.push(`「${item.name}」の年齢を確認してください。`);
        return;
      }
      if (item.period !== "once" && item.startAge > item.endAge){
        setRowError(row, "開始年齢は終了年齢より前にしてください。");
        errors.push(`「${item.name}」の年齢の前後関係を確認してください。`);
        return;
      }
    });

    return errors;
  }

  function isFiniteNum(v){
    return typeof v === "number" && Number.isFinite(v);
  }

  function showGlobalErrors(errors){
    if (errors.length === 0){
      el.globalErrors.hidden = true;
      el.globalErrors.innerHTML = "";
      return;
    }
    el.globalErrors.hidden = false;
    const unique = Array.from(new Set(errors));
    el.globalErrors.innerHTML =
      "入力内容をご確認ください：<ul>" +
      unique.map(m => `<li>${escapeHtml(m)}</li>`).join("") +
      "</ul>";
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  /* ---------------------------------------------------------------------
     計算エンジン
     --------------------------------------------------------------------- */

  // ある年齢において、1つの項目が発生させる「その年の金額（物価上昇前）」を返す
  function occursAmount(item, age){
    const p = item.period;
    if (age < item.startAge) return 0;
    if (p === "once"){
      return age === item.startAge ? item.amount : 0;
    }
    if (age > item.endAge) return 0;
    if (p === "month"){
      return item.amount * 12;
    }
    if (p === "year"){
      return item.amount;
    }
    if (p === "everyN"){
      const n = Math.max(1, Math.round(item.n || 1));
      const diff = age - item.startAge;
      return (diff % n === 0) ? item.amount : 0;
    }
    return 0;
  }

  function runSimulation(){
    const b = state.basic;
    const inflationRate = (state.economic.inflation || 0) / 100;
    const returnRate = (state.economic.returnRate || 0) / 100;

    const rows = [];
    let asset = b.currentAssets;
    let lifetimeIncome = 0;
    let lifetimeExpense = 0;
    let maxDeficit = 0; // 最も大きい赤字（マイナス値）
    let depletionAge = null;

    for (let age = b.currentAge; age <= b.endAge; age++){
      const inflationFactor = Math.pow(1 + inflationRate, age - b.currentAge);

      let incomeSum = 0;
      state.incomes.forEach(item => {
        incomeSum += occursAmount(item, age);
      });
      if (age === b.retireAge){
        incomeSum += (b.lumpSum || 0);
      }

      let expenseSum = 0;
      state.expenses.forEach(item => {
        expenseSum += occursAmount(item, age) * inflationFactor;
      });

      const net = incomeSum - expenseSum;
      const investmentReturn = asset * returnRate;
      const yearEndAsset = asset + net + investmentReturn;

      rows.push({
        age,
        income: incomeSum,
        expense: expenseSum,
        net,
        investmentReturn,
        yearEndAsset
      });

      lifetimeIncome += incomeSum;
      lifetimeExpense += expenseSum;
      if (net < maxDeficit) maxDeficit = net;

      if (depletionAge === null && yearEndAsset < 0){
        depletionAge = age;
      }

      asset = yearEndAsset;
    }

    return {
      rows,
      lifetimeIncome,
      lifetimeExpense,
      maxDeficit,
      depletionAge,
      finalAsset: rows.length ? rows[rows.length - 1].yearEndAsset : b.currentAssets
    };
  }

  /* ---------------------------------------------------------------------
     結果の描画
     --------------------------------------------------------------------- */
  function fmtMan(v){
    const rounded = Math.round(v);
    return rounded.toLocaleString("ja-JP") + "万円";
  }
  function fmtManSigned(v){
    const rounded = Math.round(v);
    const sign = rounded > 0 ? "+" : (rounded < 0 ? "▲" : "");
    return sign + Math.abs(rounded).toLocaleString("ja-JP") + "万円";
  }

  function renderDepletionBanner(result){
    const banner = el.depletionBanner;
    banner.hidden = false;
    if (result.depletionAge !== null){
      banner.classList.remove("is-safe");
      banner.textContent = `${result.depletionAge}歳で金融資産が不足する試算です`;
    } else {
      banner.classList.add("is-safe");
      banner.textContent = `試算終了年齢（${state.basic.endAge}歳）まで、資産が不足する見込みはありません`;
    }
  }

  function renderSummary(result){
    const b = state.basic;
    const items = [
      {
        label: `${b.endAge}歳時点の資産`,
        value: fmtMan(result.finalAsset),
        warn: result.finalAsset < 0
      },
      {
        label: "資産が底をつく年齢",
        value: result.depletionAge !== null ? `${result.depletionAge}歳` : "なし",
        warn: result.depletionAge !== null
      },
      {
        label: "生涯収入（合計）",
        value: fmtMan(result.lifetimeIncome),
        warn: false
      },
      {
        label: "生涯支出（合計）",
        value: fmtMan(result.lifetimeExpense),
        warn: false
      },
      {
        label: "最大の年間赤字",
        value: result.maxDeficit < 0 ? fmtManSigned(result.maxDeficit) : "赤字の年はありません",
        warn: result.maxDeficit < 0
      }
    ];
    el.summaryGrid.innerHTML = items.map(it => `
      <div class="summary-item ${it.warn ? "is-warn" : ""}">
        <span class="s-label">${escapeHtml(it.label)}</span>
        <span class="s-value">${escapeHtml(it.value)}</span>
      </div>
    `).join("");
  }

  function renderTable(result){
    const milestoneAges = new Set([60, 65, 70, 75, 80, 85, 90]);
    el.detailTableBody.innerHTML = result.rows.map(r => {
      const negative = r.yearEndAsset < 0;
      const milestone = milestoneAges.has(r.age);
      const cls = [negative ? "row-negative" : "", (!negative && milestone) ? "row-milestone" : ""]
        .filter(Boolean).join(" ");
      return `
        <tr class="${cls}">
          <td>${r.age}歳</td>
          <td>${fmtMan(r.income)}</td>
          <td>${fmtMan(r.expense)}</td>
          <td>${fmtManSigned(r.net)}</td>
          <td>${fmtMan(r.yearEndAsset)}</td>
        </tr>
      `;
    }).join("");
  }

  function renderChart(result){
    const ages = result.rows.map(r => r.age);
    const values = result.rows.map(r => Math.round(r.yearEndAsset));

    const ctx = el.chartCanvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, 320);
    gradient.addColorStop(0, "rgba(47,111,94,0.35)");
    gradient.addColorStop(1, "rgba(47,111,94,0.02)");

    const negGradient = ctx.createLinearGradient(0, 0, 0, 320);
    negGradient.addColorStop(0, "rgba(166,64,45,0.05)");
    negGradient.addColorStop(1, "rgba(166,64,45,0.35)");

    if (chartInstance){
      chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels: ages,
        datasets: [
          {
            label: "金融資産残高",
            data: values,
            borderColor: "#2F6F5E",
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: "#2F6F5E",
            fill: { target: { value: 0 }, above: gradient, below: negGradient },
            tension: 0.15,
            segment: {
              borderColor: ctx => (ctx.p0.parsed.y < 0 || ctx.p1.parsed.y < 0) ? "#A6402D" : "#2F6F5E"
            }
          },
          {
            label: "ゼロライン",
            data: ages.map(() => 0),
            borderColor: "#A6402D",
            borderWidth: 1,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#202B23",
            titleFont: { family: "'Noto Sans JP', sans-serif", weight: "700" },
            bodyFont: { family: "'Noto Sans JP', sans-serif" },
            padding: 10,
            callbacks: {
              title: (items) => `${items[0].label}歳`,
              label: (item) => {
                if (item.datasetIndex === 1) return null;
                const v = item.parsed.y;
                return `資産残高：${v.toLocaleString("ja-JP")}万円`;
              }
            },
            filter: (item) => item.datasetIndex === 0
          }
        },
        scales: {
          x: {
            ticks: {
              color: "#59645B",
              font: { family: "'Noto Sans JP', sans-serif", size: 11 },
              callback: function(val, idx){
                const age = ages[idx];
                return (age % 5 === 0) ? age + "歳" : "";
              },
              maxRotation: 0,
              autoSkip: false
            },
            grid: { color: "#E3E5DA" },
            border: { display: false }
          },
          y: {
            ticks: {
              color: "#59645B",
              font: { family: "'Noto Sans JP', sans-serif", size: 11 },
              callback: (val) => val.toLocaleString("ja-JP") + "万円"
            },
            grid: { color: "#E3E5DA" },
            border: { display: false }
          }
        }
      }
    });
  }

  function renderResults(result){
    renderDepletionBanner(result);
    renderSummary(result);
    renderChart(result);
    renderTable(result);
  }

  /* ---------------------------------------------------------------------
     タブ切り替え
     --------------------------------------------------------------------- */
  function switchTab(tab){
    const toInput = tab === "input";
    el.panelInput.classList.toggle("is-active", toInput);
    el.panelResult.classList.toggle("is-active", !toInput);
    el.tabBtnInput.classList.toggle("is-active", toInput);
    el.tabBtnResult.classList.toggle("is-active", !toInput);
    el.tabBtnInput.setAttribute("aria-selected", String(toInput));
    el.tabBtnResult.setAttribute("aria-selected", String(!toInput));
    if (!toInput) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------------------------------------------------------------------
     データ保存（LocalStorage・5枠までの保存スロット）
     --------------------------------------------------------------------- */
  function getSlot(n){
    try {
      const raw = localStorage.getItem(SLOT_PREFIX + n);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e){
      return null;
    }
  }
  function setSlot(n, slotData){
    localStorage.setItem(SLOT_PREFIX + n, JSON.stringify(slotData));
  }
  function formatSavedAt(iso){
    try {
      const d = new Date(iso);
      return d.toLocaleString("ja-JP", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit"
      });
    } catch (e){
      return "";
    }
  }
  function slotSummary(slotData){
    if (!slotData || !slotData.state) return "";
    const b = slotData.state.basic || {};
    const parts = [];
    if (isFiniteNum(b.currentAge)) parts.push(`現在${b.currentAge}歳`);
    if (isFiniteNum(b.currentAssets)) parts.push(`資産${b.currentAssets.toLocaleString("ja-JP")}万円`);
    return parts.join("／");
  }

  let slotModalMode = null; // "save" | "load"
  let slotModalSelected = null;

  function openSlotModal(mode){
    slotModalMode = mode;
    slotModalSelected = null;
    el.slotModalTitle.textContent = mode === "save" ? "保存先を選択" : "読み込むデータを選択";
    el.slotModalNote.textContent = mode === "save"
      ? "保存する枠を選んでください。既にデータがある枠を選ぶと上書きされます。"
      : "読み込む枠を選んでください。現在の入力内容は読み込んだ内容で置き換わります。";
    renderSlotList();
    el.slotModalConfirm.disabled = true;
    el.slotModal.hidden = false;
  }
  function closeSlotModal(){
    el.slotModal.hidden = true;
    slotModalMode = null;
    slotModalSelected = null;
  }

  function renderSlotList(){
    el.slotList.innerHTML = "";
    for (let n = 1; n <= NUM_SLOTS; n++){
      const slotData = getSlot(n);
      const isEmpty = !slotData;
      const disabledForLoad = slotModalMode === "load" && isEmpty;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot-item" + (isEmpty ? " is-empty" : "") + (disabledForLoad ? " is-disabled" : "");
      btn.disabled = disabledForLoad;
      btn.dataset.slot = String(n);

      const title = isEmpty ? "空き" : `保存日時：${formatSavedAt(slotData.savedAt)}`;
      const meta = isEmpty ? "まだデータがありません" : (slotSummary(slotData) || "");

      btn.innerHTML = `
        <span class="slot-badge">${n}</span>
        <span class="slot-info">
          <span class="slot-title">スロット${n}　${escapeHtml(title)}</span>
          <span class="slot-meta">${escapeHtml(meta)}</span>
        </span>
        <span class="slot-check" aria-hidden="true"></span>
      `;

      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        slotModalSelected = n;
        Array.from(el.slotList.children).forEach(c => c.classList.remove("is-selected"));
        btn.classList.add("is-selected");
        el.slotModalConfirm.disabled = false;
      });

      el.slotList.appendChild(btn);
    }
  }

  function confirmSlotModal(){
    if (!slotModalSelected) return;
    const n = slotModalSelected;

    if (slotModalMode === "save"){
      const existing = getSlot(n);
      if (existing){
        const ok = window.confirm(`スロット${n}には既にデータがあります。上書きしてよろしいですか？`);
        if (!ok) return;
      }
      try {
        setSlot(n, { savedAt: new Date().toISOString(), state: state });
        flashStatus(`スロット${n}に保存しました。`);
        closeSlotModal();
      } catch (e){
        flashStatus("保存できませんでした。ブラウザの設定をご確認ください。");
      }
      return;
    }

    if (slotModalMode === "load"){
      const slotData = getSlot(n);
      if (!slotData) return;
      const ok = window.confirm(`スロット${n}のデータを読み込みます。現在の入力内容は上書きされます。よろしいですか？`);
      if (!ok) return;
      try {
        state = slotData.state;
        fillBasicFields();
        renderItemList("income");
        renderItemList("expense");
        flashStatus(`スロット${n}を読み込みました。`);
        closeSlotModal();
      } catch (e){
        flashStatus("読み込みに失敗しました。");
      }
      return;
    }
  }

  function resetToDefault(){
    state = defaultState();
    fillBasicFields();
    renderItemList("income");
    renderItemList("expense");
    flashStatus("初期状態に戻しました。");
  }
  function flashStatus(msg){
    el.saveStatus.textContent = msg;
    window.clearTimeout(flashStatus._t);
    flashStatus._t = window.setTimeout(() => { el.saveStatus.textContent = ""; }, 3500);
  }

  function tryAutoRestore(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw){
        state = JSON.parse(raw);
      }
    } catch (e){ /* ignore */ }
  }

  /* ---------------------------------------------------------------------
     初期化
     --------------------------------------------------------------------- */
  function init(){
    tryAutoRestore();
    bindBasicFields();
    fillBasicFields();
    renderItemList("income");
    renderItemList("expense");

    el.btnAddIncome.addEventListener("click", () => addItem("income"));
    el.btnAddExpense.addEventListener("click", () => addItem("expense"));

    el.tabBtnInput.addEventListener("click", () => switchTab("input"));
    el.btnBack.addEventListener("click", () => switchTab("input"));

    el.tabBtnResult.addEventListener("click", () => {
      if (lastResult){ switchTab("result"); }
      else { attemptCalculate(); }
    });

    el.btnCalculate.addEventListener("click", attemptCalculate);

    el.btnSave.addEventListener("click", () => { openSlotModal("save"); });
    el.btnLoad.addEventListener("click", () => { openSlotModal("load"); });
    el.slotModalCancel.addEventListener("click", closeSlotModal);
    el.slotModalConfirm.addEventListener("click", confirmSlotModal);
    el.slotModal.addEventListener("click", (e) => {
      if (e.target === el.slotModal) closeSlotModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !el.slotModal.hidden) closeSlotModal();
    });
    el.btnReset.addEventListener("click", () => {
      if (window.confirm("入力内容を初期状態に戻します。よろしいですか？")){
        resetToDefault();
      }
    });

    // 自動保存（入力の都度、負荷を抑えるため簡易デバウンス）
    document.addEventListener("input", debounce(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e){ /* ignore */ }
    }, 600));
  }

  function attemptCalculate(){
    const errors = validate();
    showGlobalErrors(errors);
    if (errors.length > 0){
      return;
    }
    const result = runSimulation();
    lastResult = result;
    renderResults(result);
    switchTab("result");
  }

  function debounce(fn, wait){
    let t;
    return function(...args){
      window.clearTimeout(t);
      t = window.setTimeout(() => fn.apply(this, args), wait);
    };
  }

  document.addEventListener("DOMContentLoaded", init);
})();

import React, { useState, useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceDot, ResponsiveContainer } from "recharts";
import { Plus, Trash2 } from "lucide-react";

const yen = (n) => `¥${Math.round(n).toLocaleString("ja-JP")}`;
const yenSigned = (n) => `${n < 0 ? "-" : "+"}¥${Math.abs(Math.round(n)).toLocaleString("ja-JP")}`;

let uid = 100;
const newId = () => uid++;

function LedgerColumn({ title, items, setItems, tone }) {
  const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const update = (id, field, value) => {
    setItems(items.map((i) => (i.id === id ? { ...i, [field]: value } : i)));
  };
  const remove = (id) => setItems(items.filter((i) => i.id !== id));
  const add = () => setItems([...items, { id: newId(), label: "", amount: 0 }]);

  return (
    <div className="flex-1 min-w-0">
      <div
        className="text-sm tracking-widest uppercase pb-2 mb-1 border-b-2"
        style={{ color: tone, borderColor: tone, fontFamily: "'Noto Serif JP', serif" }}
      >
        {title}
      </div>
      <div>
        {items.map((item, idx) => (
          <div key={item.id} className="flex items-center gap-2 py-2 border-b" style={{ borderColor: "#D9D2C0" }}>
            <span className="text-xs w-5 shrink-0 tabular-nums" style={{ color: "#9C9484" }}>
              {String(idx + 1).padStart(2, "0")}
            </span>
            <input
              value={item.label}
              onChange={(e) => update(item.id, "label", e.target.value)}
              placeholder="項目名"
              className="flex-1 min-w-0 bg-transparent outline-none text-sm"
              style={{ color: "#1F3A5C", fontFamily: "'Noto Sans JP', sans-serif" }}
            />
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-xs" style={{ color: "#9C9484" }}>¥</span>
              <input
                type="number"
                value={item.amount}
                onChange={(e) => update(item.id, "amount", e.target.value)}
                className="w-24 bg-transparent outline-none text-right text-sm tabular-nums"
                style={{ color: "#1F3A5C", fontFamily: "'Noto Sans JP', sans-serif" }}
              />
            </div>
            <button onClick={() => remove(item.id)} className="shrink-0 opacity-40 hover:opacity-100 transition-opacity">
              <Trash2 size={14} color="#5C6B73" />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={add}
        className="flex items-center gap-1 mt-3 text-xs opacity-60 hover:opacity-100 transition-opacity"
        style={{ color: tone, fontFamily: "'Noto Sans JP', sans-serif" }}
      >
        <Plus size={13} /> 項目を追加
      </button>
      <div className="flex justify-between items-baseline mt-4 pt-3 border-t-2" style={{ borderColor: tone }}>
        <span className="text-xs" style={{ color: "#5C6B73", fontFamily: "'Noto Sans JP', sans-serif" }}>合計 / 月</span>
        <span className="text-lg font-medium tabular-nums" style={{ color: tone, fontFamily: "'Noto Sans JP', sans-serif" }}>
          {yen(total)}
        </span>
      </div>
    </div>
  );
}

function Hanko({ surplus }) {
  const color = surplus ? "#3F6D50" : "#B8492F";
  const label = surplus ? "黒字" : "赤字";
  return (
    <div
      className="w-24 h-24 rounded-full flex items-center justify-center shrink-0 select-none"
      style={{
        border: `3px double ${color}`,
        color: color,
        transform: "rotate(-8deg)",
        fontFamily: "'Noto Serif JP', serif",
      }}
    >
      <span className="text-2xl font-bold tracking-widest" style={{ writingMode: "vertical-rl" }}>
        {label}
      </span>
    </div>
  );
}

export default function RetirementSimulator() {
  const [retireAge, setRetireAge] = useState(65);
  const [lifeExpectancy, setLifeExpectancy] = useState(90);
  const [savings, setSavings] = useState(8000000);
  const [lumpSum, setLumpSum] = useState(12000000);

  const [income, setIncome] = useState([
    { id: newId(), label: "年金", amount: 220000 },
    { id: newId(), label: "その他収入（就労・年金以外）", amount: 0 },
  ]);
  const [expense, setExpense] = useState([
    { id: newId(), label: "住居費", amount: 60000 },
    { id: newId(), label: "食費", amount: 65000 },
    { id: newId(), label: "水道光熱費", amount: 22000 },
    { id: newId(), label: "保険料", amount: 15000 },
    { id: newId(), label: "通信費", amount: 10000 },
    { id: newId(), label: "その他生活費", amount: 40000 },
  ]);

  const incomeTotal = income.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const expenseTotal = expense.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const monthlyDiff = incomeTotal - expenseTotal;
  const annualDiff = monthlyDiff * 12;
  const initialAssets = (Number(savings) || 0) + (Number(lumpSum) || 0);
  const years = Math.max(0, Number(lifeExpectancy) - Number(retireAge));

  const { chartData, depletionAge, lifetimeShortfall, finalBalance } = useMemo(() => {
    const data = [];
    let balance = initialAssets;
    let depletion = null;
    for (let y = 0; y <= years; y++) {
      const age = Number(retireAge) + y;
      if (y > 0) balance += annualDiff;
      data.push({ age, balance: Math.round(balance) });
      if (depletion === null && balance < 0) depletion = age;
    }
    const final = data.length ? data[data.length - 1].balance : initialAssets;
    const shortfall = final < 0 ? -final : 0;
    return { chartData: data, depletionAge: depletion, lifetimeShortfall: shortfall, finalBalance: final };
  }, [initialAssets, annualDiff, years, retireAge]);

  const surplus = monthlyDiff >= 0;
  const monthsToClose = surplus || monthlyDiff === 0 ? null : Math.abs(lifetimeShortfall / (Math.abs(monthlyDiff) * 12));

  return (
    <div
      className="min-h-screen w-full py-10 px-4 sm:px-8"
      style={{ backgroundColor: "#EFEEE6" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@500;700&family=Noto+Sans+JP:wght@400;500;700&display=swap');
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}</style>

      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-10 text-center">
          <div
            className="text-3xl sm:text-4xl font-bold mb-2"
            style={{ color: "#1F3A5C", fontFamily: "'Noto Serif JP', serif" }}
          >
            老後資金シミュレーター
          </div>
          <div className="text-sm" style={{ color: "#5C6B73", fontFamily: "'Noto Sans JP', sans-serif" }}>
            年金・収入と生活費を書き込み、毎月の過不足と資金の寿命を確かめます
          </div>
        </div>

        {/* Basic info */}
        <div
          className="flex flex-wrap gap-6 justify-between mb-8 p-5 rounded-sm"
          style={{ backgroundColor: "#F8F7F2", border: "1px solid #D9D2C0" }}
        >
          {[
            ["退職（開始）年齢", retireAge, setRetireAge, "歳"],
            ["想定寿命年齢", lifeExpectancy, setLifeExpectancy, "歳"],
          ].map(([label, val, setter, unit]) => (
            <div key={label} className="flex-1 min-w-[140px]">
              <div className="text-xs mb-1" style={{ color: "#5C6B73", fontFamily: "'Noto Sans JP', sans-serif" }}>
                {label}
              </div>
              <div className="flex items-baseline gap-1">
                <input
                  type="number"
                  value={val}
                  onChange={(e) => setter(e.target.value)}
                  className="w-16 bg-transparent outline-none text-xl font-medium tabular-nums border-b-2"
                  style={{ color: "#1F3A5C", borderColor: "#1F3A5C", fontFamily: "'Noto Sans JP', sans-serif" }}
                />
                <span className="text-sm" style={{ color: "#5C6B73" }}>{unit}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Ledger */}
        <div
          className="flex flex-col sm:flex-row gap-8 sm:gap-0 p-6 sm:p-8 rounded-sm mb-8"
          style={{ backgroundColor: "#F8F7F2", border: "1px solid #D9D2C0" }}
        >
          <LedgerColumn title="収入（月額）" items={income} setItems={setIncome} tone="#3F6D50" />
          <div className="hidden sm:block w-px mx-8" style={{ backgroundColor: "#D9D2C0" }} />
          <LedgerColumn title="支出（月額）" items={expense} setItems={setExpense} tone="#B8492F" />
        </div>

        {/* Assets */}
        <div
          className="flex flex-wrap gap-6 justify-between mb-8 p-5 rounded-sm"
          style={{ backgroundColor: "#F8F7F2", border: "1px solid #D9D2C0" }}
        >
          <div className="text-sm w-full mb-1" style={{ color: "#1F3A5C", fontFamily: "'Noto Serif JP', serif" }}>
            資産（退職時点）
          </div>
          {[
            ["預貯金など", savings, setSavings],
            ["退職金", lumpSum, setLumpSum],
          ].map(([label, val, setter]) => (
            <div key={label} className="flex-1 min-w-[160px]">
              <div className="text-xs mb-1" style={{ color: "#5C6B73", fontFamily: "'Noto Sans JP', sans-serif" }}>
                {label}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-sm" style={{ color: "#5C6B73" }}>¥</span>
                <input
                  type="number"
                  value={val}
                  onChange={(e) => setter(e.target.value)}
                  className="flex-1 bg-transparent outline-none text-lg font-medium tabular-nums border-b-2"
                  style={{ color: "#1F3A5C", borderColor: "#1F3A5C", fontFamily: "'Noto Sans JP', sans-serif" }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Result stamp */}
        <div
          className="flex items-center gap-6 p-6 sm:p-8 rounded-sm mb-8"
          style={{ backgroundColor: "#F8F7F2", border: "1px solid #D9D2C0" }}
        >
          <Hanko surplus={surplus} />
          <div className="flex-1 min-w-0">
            <div className="text-xs mb-1" style={{ color: "#5C6B73", fontFamily: "'Noto Sans JP', sans-serif" }}>
              月次収支
            </div>
            <div
              className="text-2xl sm:text-3xl font-bold tabular-nums mb-2"
              style={{ color: surplus ? "#3F6D50" : "#B8492F", fontFamily: "'Noto Sans JP', sans-serif" }}
            >
              {yenSigned(monthlyDiff)} <span className="text-sm font-normal">/月</span>
            </div>
            <div className="text-sm tabular-nums" style={{ color: "#5C6B73", fontFamily: "'Noto Sans JP', sans-serif" }}>
              年間換算 {yenSigned(annualDiff)}
            </div>
          </div>
        </div>

        {/* Chart */}
        <div
          className="p-6 sm:p-8 rounded-sm mb-8"
          style={{ backgroundColor: "#F8F7F2", border: "1px solid #D9D2C0" }}
        >
          <div className="text-sm mb-4" style={{ color: "#1F3A5C", fontFamily: "'Noto Serif JP', serif" }}>
            資産残高の推移（{retireAge}歳〜{lifeExpectancy}歳）
          </div>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={surplus ? "#3F6D50" : "#B8492F"} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={surplus ? "#3F6D50" : "#B8492F"} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#D9D2C0" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="age" tick={{ fontSize: 11, fill: "#5C6B73" }} tickFormatter={(a) => `${a}歳`} />
                <YAxis tick={{ fontSize: 11, fill: "#5C6B73" }} tickFormatter={(v) => `${Math.round(v / 10000)}万`} width={50} />
                <ReferenceLine y={0} stroke="#1F3A5C" strokeWidth={1} />
                <Tooltip
                  formatter={(v) => [yen(v), "残高"]}
                  labelFormatter={(a) => `${a}歳`}
                  contentStyle={{ backgroundColor: "#F8F7F2", border: "1px solid #D9D2C0", fontFamily: "'Noto Sans JP', sans-serif", fontSize: 12 }}
                />
                <Area type="monotone" dataKey="balance" stroke={surplus ? "#3F6D50" : "#B8492F"} strokeWidth={2} fill="url(#balanceFill)" />
                {depletionAge !== null && (
                  <ReferenceDot x={depletionAge} y={0} r={5} fill="#B8492F" stroke="#F8F7F2" strokeWidth={2} />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Summary */}
        <div
          className="p-6 sm:p-8 rounded-sm"
          style={{ backgroundColor: "#1F3A5C" }}
        >
          <div className="text-sm mb-4 opacity-80" style={{ color: "#EFEEE6", fontFamily: "'Noto Serif JP', serif" }}>
            まとめ
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <div className="text-xs opacity-60 mb-1" style={{ color: "#EFEEE6", fontFamily: "'Noto Sans JP', sans-serif" }}>
                資金が尽きる年齢
              </div>
              <div className="text-xl font-bold tabular-nums" style={{ color: depletionAge ? "#E8A08C" : "#8FC29E", fontFamily: "'Noto Sans JP', sans-serif" }}>
                {depletionAge !== null ? `${depletionAge}歳（寿命の${lifeExpectancy - depletionAge}年前）` : "尽きません"}
              </div>
            </div>
            <div>
              <div className="text-xs opacity-60 mb-1" style={{ color: "#EFEEE6", fontFamily: "'Noto Sans JP', sans-serif" }}>
                生涯の不足額（想定寿命まで）
              </div>
              <div className="text-xl font-bold tabular-nums" style={{ color: lifetimeShortfall > 0 ? "#E8A08C" : "#8FC29E", fontFamily: "'Noto Sans JP', sans-serif" }}>
                {lifetimeShortfall > 0 ? yen(lifetimeShortfall) : "不足なし"}
              </div>
            </div>
          </div>
          {lifetimeShortfall > 0 && (
            <div className="mt-4 pt-4 text-sm opacity-80" style={{ borderTop: "1px solid rgba(239,238,230,0.2)", color: "#EFEEE6", fontFamily: "'Noto Sans JP', sans-serif" }}>
              毎月あと {yen(-monthlyDiff)} の収入増加、または支出削減があれば収支は均衡します。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

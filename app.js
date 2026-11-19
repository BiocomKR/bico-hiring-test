/* 시험 진행, 결과 탭. 답은 이 브라우저의 localStorage 에만 저장된다. */
(function () {
  const E = window.EXAM;
  const KEY = "bico-exam-" + E.version;
  const DUR = E.durationMin * 60 * 1000;
  const $ = (sel) => document.querySelector(sel);
  let state = load();
  state.comboOff = state.comboOff || {};
  state.visits = state.visits || {};
  state.pending = state.pending || {};
  let grading = null;
  let tab = "exam";

  function fresh() {
    return { phase: "intro", name: "", answers: {}, edits: {}, revealed: 1, editing: null,
      away: { count: 0, ms: 0, since: null }, overrides: {}, comboOff: {}, fmemo: {}, memo: "", visits: {}, pending: {}, clock: null };
  }
  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || fresh();
    } catch (e) {
      console.error("저장된 시험 상태를 읽지 못함", e);
      return fresh();
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      alert("브라우저에 답을 저장하지 못했습니다. 감독관에게 알려 주세요.");
      throw e;
    }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmt(ts, withTime) {
    if (!ts) return "-";
    const o = { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" };
    if (withTime) Object.assign(o, { hour: "2-digit", minute: "2-digit", hour12: false });
    const p = Object.fromEntries(new Intl.DateTimeFormat("ko-KR", o).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
    const d = p.year + "-" + p.month + "-" + p.day;
    return withTime ? d + " " + p.hour + ":" + p.minute : d;
  }
  function decodeFact(id) {
    const b = atob(window.CARDS[id]);
    return new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0)));
  }
  const qById = (id) => E.questions.find((q) => q.id === id);

  /* ---------- 시간, 화면 이탈 ---------- */
  function remaining() {
    return state.startedAt ? state.startedAt + DUR - Date.now() : DUR;
  }
  function tick() {
    if (state.phase !== "exam") return;
    const left = remaining();
    if (left <= 0) return submit(true);
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    const t = $("#timer");
    if (t) {
      t.textContent = (left <= E.warnMin * 60000 ? "⚠ 5분 미만 " : "남은 시간 ") + m + ":" + String(s).padStart(2, "0");
      t.classList.toggle("warn", left <= E.warnMin * 60000);
    }
  }
  function onAway() {
    if (state.phase !== "exam") return;
    if (document.hidden && !state.away.since) {
      state.away.since = Date.now();
      state.away.count += 1;
    } else if (!document.hidden && state.away.since) {
      state.away.ms += Date.now() - state.away.since;
      state.away.since = null;
    }
    save();
  }

  /* ---------- 진행 ---------- */
  function start() {
    const name = $("#name").value.trim();
    const raw = $("#years").value.trim();
    const years = Number(raw);
    if (!name) return alert("이름을 입력해 주세요.");
    if (raw === "" || !Number.isInteger(years) || years < 0 || years > 40) return alert("개발 연차를 0~40 사이 숫자로 입력해 주세요. 신입은 0입니다.");
    Object.assign(state, { phase: "exam", name, years, startedAt: Date.now() });
    clockTo("q1");
    save();
    render();
  }
  // 문항별 시간: 그 문항의 입력 칸이 열려 있던 시간만 그 문항에 쌓는다
  function clockTo(qid) {
    const c = state.clock;
    if (c && c.qid) state.pending[c.qid] = (state.pending[c.qid] || 0) + (Date.now() - c.since);
    state.clock = qid ? { qid, since: Date.now() } : null;
  }
  function currentQ() {
    if (state.editing) return state.editing;
    const q = E.questions.slice(0, state.revealed).find((x) => !state.answers[x.id]);
    return q ? q.id : null;
  }
  function readForm(q) {
    if (q.type === "slots") {
      const pick = (s) => (document.querySelector("input[name=opt-" + q.id + "-" + s.id + "]:checked") || {}).value || null;
      return { slots: Object.fromEntries(q.slots.map((s) => [s.id, pick(s)])) };
    }
    if (q.type !== "single") {
      const picked = [...document.querySelectorAll("input[name=opt-" + q.id + "]:checked")].map((i) => i.value);
      return q.type === "cards" ? { cards: picked } : { options: picked };
    }
    const sel = document.querySelector("input[name=opt-" + q.id + "]:checked");
    return { option: sel ? sel.value : null };
  }
  function validate(q, a) {
    if (q.type === "cards") {
      if (a.cards.length !== q.pick) return "카드를 " + q.pick + "장 골라 주세요.";
      return confirm("카드를 열면 바꿀 수 없어요. 이 3장을 열까요?") ? null : "";
    }
    if (q.type === "slots") return Object.values(a.slots).some((v) => !v) ? "칸마다 하나씩 골라 주세요." : null;
    if (q.type === "pick" && a.options.length > q.max) return "보기는 " + q.max + "개까지 고를 수 있어요.";
    const empty = q.type === "single" ? !a.option : !a.options.length;
    return empty ? "보기를 하나 이상 골라 주세요." : null;
  }
  function quietValid(q, a) {
    if (q.type === "cards") return a.cards.length === q.pick;
    if (q.type === "slots") return Object.values(a.slots).every(Boolean);
    if (q.type === "single") return !!a.option;
    return a.options.length > 0 && !(q.type === "pick" && a.options.length > q.max);
  }
  function record(qid, a) {
    if (state.answers[qid]) state.edits[qid] = (state.edits[qid] || 0) + 1;
    clockTo(null);
    (state.visits[qid] = state.visits[qid] || []).push({ ms: state.pending[qid] || 0, answer: a });
    state.pending[qid] = 0;
    state.answers[qid] = a;
    state.editing = null;
  }
  // 시간 종료 때 고르기만 하고 안 보낸 답을 버리지 않는다
  function captureOpen() {
    const qid = currentQ();
    if (!qid || !document.querySelector(`[data-act=send][data-q=${qid}]`)) return;
    const q = qById(qid);
    const a = readForm(q);
    if (quietValid(q, a)) record(qid, a);
  }
  function scrollToCurrent() {
    const chat = $("#chat");
    const turns = chat ? chat.querySelectorAll(".turn") : [];
    if (!turns.length) return;
    const el = state.editing ? chat.querySelector(`[data-turn="${state.editing}"]`) : turns[turns.length - 1];
    if (el) chat.scrollTop = el.offsetTop - chat.offsetTop - 8;
  }
  function send(qid) {
    if (state.editing && state.editing !== qid) return alert("고치던 답이 있어요. 먼저 「보내기」나 「취소」를 눌러 주세요.");
    const q = qById(qid);
    const a = readForm(q);
    const err = validate(q, a);
    if (err) return err && alert(err);
    record(qid, a);
    const idx = E.questions.indexOf(q);
    state.revealed = Math.max(state.revealed, Math.min(idx + 2, E.questions.length));
    clockTo(currentQ());
    save();
    render();
    scrollToCurrent();
  }
  function submit(auto) {
    if (!auto && !confirm("최종 제출할까요? 제출하면 더 고칠 수 없어요.")) return;
    if (auto) captureOpen();
    if (state.away.since) {
      state.away.ms += Date.now() - state.away.since;
      state.away.since = null;
    }
    clockTo(null);
    Object.assign(state, { phase: "done", endedAt: Date.now(), autoSubmitted: !!auto, editing: null });
    save();
    render();
    const chat = $("#chat");
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  /* ---------- 지원자 화면 ---------- */
  function legacyHtml() {
    const old = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k.startsWith("bico-exam-") || k === KEY) continue;
      try {
        const v = JSON.parse(localStorage.getItem(k));
        if (v && v.phase && v.phase !== "intro") old.push(esc(v.name || "이름 없음") + " (" + esc(k.replace("bico-exam-", "")) + " 판)");
      } catch (e) { console.error("이전 기록 읽기 실패", k, e); }
    }
    if (!old.length) return "";
    return `<p class="lv-warn">이 기기에 이전 판으로 푼 기록이 남아 있습니다: ${old.join(", ")}. 새 판에서는 결과를 볼 수 없으니 담당 개발자에게 알려 주세요. 기록은 지워지지 않았습니다.</p>`;
  }
  function introHtml() {
    return `<section class="intro card">${legacyHtml()}
      <h2>${esc(E.title)}</h2>
      <ul class="rules">${E.rules.map((r) => "<li>" + esc(r) + "</li>").join("")}</ul>
      <label class="field">지원자 이름<input id="name" autocomplete="off" placeholder="이름을 입력하세요"></label>
      <label class="field">개발 연차 (년)<input id="years" type="number" inputmode="numeric" min="0" max="40" step="1" placeholder="신입은 0"></label>
      <button class="primary" data-act="start">시험 시작</button>
    </section>`;
  }
  function factsHtml() {
    const opened = (state.answers.q1 && state.answers.q1.cards) || [];
    if (!opened.length) return '<p class="muted">아직 확인한 정보가 없습니다.</p>';
    return opened.map((id) => '<div class="fact">' + esc(decodeFact(id)) + "</div>").join("");
  }
  function problemHtml() {
    return `<div class="pane-scroll">
      <h3>상황</h3>${E.scenarioHtml}
      <h3>확인한 정보</h3>${factsHtml()}
      <h3>AI 초안 설계안</h3><div class="draft">${E.draftHtml}</div>
    </div>`;
  }
  const cancelBtn = (q) => (state.editing === q.id ? ' <button data-act="cancel">취소</button>' : "");
  function slotsInputHtml(q, a) {
    const cur = a.slots || {};
    const groups = q.slots.map((s) => `<fieldset class="slot"><legend>${esc(s.label)}</legend>${s.options.map((o) =>
      `<label class="opt"><input type="radio" name="opt-${q.id}-${s.id}" value="${o.id}" ${cur[s.id] === o.id ? "checked" : ""}><span>${esc(o.text)}</span></label>`).join("")}</fieldset>`).join("");
    return `<div class="answer-form"><p class="hint">칸마다 하나씩 고르세요.</p>${groups}
      <button class="primary" data-act="send" data-q="${q.id}">보내기</button>${cancelBtn(q)}</div>`;
  }
  function slotText(q, a) {
    return q.slots.map((s) => (s.options.find((o) => o.id === (a.slots || {})[s.id]) || {}).text || "(고르지 않음)");
  }
  function inputHtml(q) {
    const a = state.answers[q.id] || {};
    if (q.type === "slots") return slotsInputHtml(q, a);
    const isMulti = q.type !== "single";
    const items = q.type === "cards" ? q.cards.map((c) => ({ id: c.id, text: c.label })) : q.options;
    const chosen = a.cards || a.options || (a.option ? [a.option] : []);
    const opts = items.map((o) => `<label class="opt"><input type="${isMulti ? "checkbox" : "radio"}" name="opt-${q.id}" value="${o.id}" ${chosen.includes(o.id) ? "checked" : ""}><span>${esc(o.text)}</span></label>`).join("");
    const hints = { cards: q.pick + "장을 고르세요. 열면 바꿀 수 없어요.", multi: "해당하는 것을 모두 고르세요. 해당하지 않는 것을 고르면 감점돼요.",
      pick: (q.max || 2) + "개까지 고를 수 있어요. 맞지 않는 보기를 함께 고르면 감점돼요.", single: "하나를 고르세요." };
    const limit = q.type === "cards" ? q.pick : q.type === "pick" ? q.max || 2 : 0;
    return `<div class="answer-form" data-limit="${limit}">
      <p class="hint">${hints[q.type]}</p>${opts}
      <button class="primary" data-act="send" data-q="${q.id}">보내기</button>${cancelBtn(q)}
    </div>`;
  }
  function answerText(q, a) {
    if (q.type === "slots") return slotText(q, a).map((t, i) => "• " + q.slots[i].label + ": " + t).join("\n");
    const items = q.type === "cards" ? q.cards.map((c) => ({ id: c.id, text: c.label })) : q.options;
    const ids = a.cards || a.options || (a.option ? [a.option] : []);
    const lines = ids.map((id) => "• " + (items.find((o) => o.id === id) || {}).text);
    return lines.join("\n");
  }
  function questionHtml(q, i) {
    const a = state.answers[q.id];
    const editable = state.phase === "exam" && !(q.lockOnSend && a);
    let body;
    if (state.phase === "exam" && (!a || state.editing === q.id)) body = inputHtml(q);
    else body = `<div class="bubble me">${esc(answerText(q, a || {})) || "(답 없음)"}${editable ? `<button class="edit-btn" data-act="edit" data-q="${q.id}">수정</button>` : ""}</div>`;
    return `<div class="turn" data-turn="${q.id}"><div class="bubble ai"><span class="who">AI 동료 (${i + 1}/${E.questions.length}) ${esc(q.title)}</span>${esc(q.ai)}</div>${body}</div>`;
  }
  function chatHtml() {
    const shown = E.questions.slice(0, state.phase === "done" ? E.questions.length : state.revealed);
    let html = shown.map(questionHtml).join("");
    const allDone = E.questions.every((q) => state.answers[q.id]);
    if (state.phase === "exam" && allDone && !state.editing) {
      html += `<div class="turn"><div class="bubble ai"><span class="who">AI 동료</span>모든 질문에 답했어요. 고칠 답이 있으면 「수정」을 누르고, 다 됐으면 최종 제출해 주세요.</div>
        <button class="primary" data-act="submit">최종 제출</button></div>`;
    }
    if (state.phase === "done") html += `<div class="done card">${state.autoSubmitted ? "시간이 끝나 그때까지 고른 답으로 자동 제출되었습니다." : "제출이 끝났습니다."} 감독관에게 알려 주세요.</div>`;
    return html;
  }
  function examHtml() {
    if (state.phase === "intro") return introHtml();
    return `<div class="split"><aside class="pane problem">${problemHtml()}</aside>
      <section class="pane chat" id="chat">${chatHtml()}</section></div>`;
  }

  /* ---------- 결과 탭 ---------- */
  async function unlock() {
    const pw = $("#pw").value;
    try {
      const res = await fetch("grading.enc.json", { cache: "no-store" });
      const box = await res.json();
      const raw = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
      const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: raw(box.salt), iterations: box.iter, hash: "SHA-256" },
        base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw(box.iv) }, key, raw(box.data));
      grading = JSON.parse(new TextDecoder().decode(plain));
      render();
    } catch (e) {
      console.error("결과 탭 열기 실패", e);
      alert("비밀번호가 맞지 않거나 채점 파일을 읽지 못했습니다.");
    }
  }
  function lockHtml() {
    return `<section class="card intro"><h2>평가 결과 (면접관 전용)</h2>
      <label class="field">비밀번호<input id="pw" type="password" autocomplete="off"></label>
      <button class="primary" data-act="unlock">열기</button></section>`;
  }
  const num = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  function tone(got, max) {
    const r = max ? got / max : 0;
    return r >= 0.99 ? "s3" : r >= 0.6 ? "s2" : r >= 0.3 ? "s1" : "s0";
  }
  function itemsOf(q) {
    return q.type === "cards" ? q.cards.map((c) => ({ id: c.id, text: c.label })) : q.options;
  }
  function pickedOf(a) {
    return a ? a.cards || a.options || (a.option ? [a.option] : []) : [];
  }
  function bestOf(g) {
    if (g.kind === "cards") return g.high;
    if (g.kind === "multi") return g.flaws;
    if (g.kind === "pick") return Object.keys(g.pairs).find((k) => g.pairs[k] === 3).split("+");
    const top = Math.max(...Object.values(g.options));
    return Object.keys(g.options).filter((k) => g.options[k] === top);
  }
  function optLabel(g, id, chosen) {
    if (g.kind === "multi") {
      const L = g.labels || { hit: "결함 맞힘", miss: "놓친 결함", wrong: "결함 아님, 감점", fine: "결함 아님" };
      if (g.flaws.includes(id)) return chosen ? ["good", L.hit] : ["miss", L.miss];
      return chosen ? ["bad", L.wrong] : ["", L.fine];
    }
    if (g.kind === "cards") {
      const w = g.weights[id] || 0;
      return [chosen ? (w >= 1 ? "good" : w > 0 ? "mid" : "bad") : w >= 1 ? "miss" : "", num(w) + "점"];
    }
    const v = g.options[id] || 0;
    return [v === 0 ? "bad" : v >= 2 ? "good" : "mid", num(v) + "점"];
  }
  function optionsTable(q, a, r) {
    const g = grading.questions[q.id];
    const chosen = pickedOf(a);
    const best = bestOf(g);
    const rows = itemsOf(q).map((o) => {
      const isC = chosen.includes(o.id);
      const [cls, label] = optLabel(g, o.id, isC);
      const mark = isC ? '<span class="pick">고름</span>' : '<span class="pick off"></span>';
      const star = best.includes(o.id) && g.kind !== "multi" && g.kind !== "cards" ? '<span class="best">정답</span>' : "";
      const letter = g.kind === "single" || g.kind === "pick" ? `<span class="oid">${o.id.toUpperCase()}</span>` : "";
      return `<li class="opt-row ${isC ? "chosen" : ""}">${mark}${letter}<span class="otext">${esc(o.text)}</span>${star}<span class="chip ${cls}">${label}</span></li>`;
    }).join("");
    const pair = g.kind === "pick"
      ? `<p class="note">정답 짝: <b>${best.map((x) => x.toUpperCase()).join(" + ")}</b>${r.pair ? " → 지원자가 정답 짝을 골랐습니다" : ""} <span class="muted">(정답 짝은 3점, 보기 점수를 더한 값이 아님)</span></p>` : "";
    const stat = g.kind === "multi" ? `<p class="note">맞게 고른 것 ${r.right || 0}개, 잘못 고른 것 ${r.wrong || 0}개</p>` : "";
    return `<ul class="opt-list">${rows}</ul>${pair}${stat}`;
  }
  function slotsTable(q, a) {
    const g = grading.questions[q.id];
    return q.slots.map((s) => {
      const rows = s.options.map((o) => {
        const isC = (a.slots || {})[s.id] === o.id;
        const v = g.slots[s.id][o.id] || 0;
        return `<li class="opt-row ${isC ? "chosen" : ""}">${isC ? '<span class="pick">고름</span>' : '<span class="pick off"></span>'}<span class="otext">${esc(o.text)}</span>${v ? '<span class="best">정답</span>' : ""}<span class="chip ${v ? "good" : "bad"}">${num(v)}점</span></li>`;
      }).join("");
      return `<p class="note"><b>${esc(s.label)}</b></p><ul class="opt-list">${rows}</ul>`;
    }).join("");
  }
  const dur = (ms) => Math.floor(ms / 60000) + ":" + String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  function shortAns(a) {
    if (a.slots) return Object.values(a.slots).map((v) => String(v).toUpperCase()).join("/");
    const ids = a.cards || a.options || (a.option ? [a.option] : []);
    return ids.map((x) => x.toUpperCase()).join("+") || "(없음)";
  }
  function timeOf(qid) {
    const v = state.visits[qid] || [];
    return { visits: v, total: v.reduce((s, x) => s + x.ms, 0) };
  }
  function timeHtml(qid, longest) {
    const t = timeOf(qid);
    if (!t.visits.length) return "";
    const edits = t.visits.slice(1);
    const detail = edits.length ? ` (첫 답 ${dur(t.visits[0].ms)}, 수정 ${edits.map((x) => dur(x.ms)).join(", ")})` : "";
    const hist = edits.length ? `<p class="note">답 변화: ${t.visits.map((x) => esc(shortAns(x.answer))).join(" → ")}</p>` : "";
    const flag = qid === longest ? '<span class="chip mid">가장 오래 걸림</span>' : t.total < 10000 ? '<span class="chip mid">10초 안에 답함</span>' : "";
    return `<p class="note time">⏱ 풀이 시간 <b>${dur(t.total)}</b>${detail} ${flag}</p>${hist}`;
  }
  function longestQ() {
    return E.questions.map((q) => [q.id, timeOf(q.id).total]).sort((a, b) => b[1] - a[1])[0][0];
  }
  function qResultHtml(q, i, sc) {
    const g = grading.questions[q.id];
    const r = sc.per[q.id];
    const a = state.answers[q.id];
    const ov = state.overrides[q.id];
    const steps = ["", 0, 0.5, 1, 1.5, 2, 2.5, 3];
    const sel = steps.map((v) => `<option value="${v}" ${String(ov ?? "") === String(v) ? "selected" : ""}>${v === "" ? "자동 " + num(r.auto) + "점" : num(v) + "점"}</option>`).join("");
    const changed = ov !== undefined && ov !== "" ? '<span class="chip mid">면접관 수정</span>' : "";
    return `<div class="qres card ${tone(r.final, 3)}" id="res-${q.id}">
      <div class="qhead">
        <span class="badge ${tone(r.final, 3)}">${num(r.final)}</span>
        <div class="qtitle"><b>${i + 1}. ${esc(q.title)}</b><span class="muted">${esc(g.type || "")}${state.edits[q.id] ? ", 수정 " + state.edits[q.id] + "회" : ""}</span></div>
        <span class="score no-print">면접관 점수 <select data-ov="${q.id}">${sel}</select></span>${changed}
      </div>
      ${timeHtml(q.id, sc.longest)}
      ${a ? (q.type === "slots" ? slotsTable(q, a) : optionsTable(q, a, r)) : '<p class="empty">답하지 않음</p>'}
      <details><summary>모범 답과 채점 기준</summary><p>${esc(g.model)}</p>${g.why ? "<p>" + esc(g.why) + "</p>" : ""}${g.kind === "pick" && grading.pickRule ? "<p>" + esc(grading.pickRule) + "</p>" : ""}</details>
    </div>`;
  }
  function overviewHtml(sc) {
    const tiles = E.questions.map((q, i) => {
      const f = sc.per[q.id].final;
      return `<a class="tile ${tone(f, 3)}" href="#res-${q.id}"><span class="tno">${i + 1}</span><span class="tsc">${num(f)}</span><span class="tname">${esc(q.title)}</span><span class="ttime">${dur(timeOf(q.id).total)}</span></a>`;
    }).join("");
    return `<div class="tiles">${tiles}</div>`;
  }
  function dimsHtml(sc) {
    return `<div class="dimbars">${sc.dims.map((d) => `<div class="dimrow">
      <span class="dname">${esc(d.name)}</span>
      <span class="bar"><span class="fill ${tone(d.got, d.max)}" style="width:${Math.round((d.got / d.max) * 100)}%"></span></span>
      <span class="dscore"><b>${num(d.got)}</b> / ${d.max}</span></div>`).join("")}</div>`;
  }
  const qNo = (qid) => E.questions.findIndex((x) => x.id === qid) + 1;
  const qLinks = (ids) => ids.length ? ids.map((q) => `<a href="#res-${q}">${qNo(q)}번 ${esc(qById(q).title)}</a>`).join(", ") : "없음";
  function reliabilityHtml(sig) {
    if (!sig.reliability.low) return "";
    return `<p class="lv-warn">점수 신뢰도 낮음, 면접에서 확인: ${esc(sig.reliability.reasons.join(". "))}.</p>`;
  }
  function signalsHtml(sig) {
    const trap = sig.traps.map((x) => `${qNo(x.qid)}번 ${x.ratio.toFixed(1)}배${x.missed ? " (빨리 답하고 틀림)" : ""}`).join(", ") || "없음";
    const row = (name, cls, value, how) => `<tr><td><b>${name}</b></td><td><span class="chip ${cls}">${value}</span></td><td class="muted">${how}</td></tr>`;
    const e = sig.edits;
    return `<div class="level card"><div class="lv-head"><b>풀이 시간 신호</b><span class="chip mid">문항 중앙값 ${dur(sig.median)}</span></div>
      <p class="muted small">${esc(grading.timeNote || "")}</p>${sig.tooFast ? '<p class="lv-warn">문항 중앙값이 15초 미만이라 성급한 오답과 숙고한 정답은 해석하지 않습니다.</p>' : ""}
      <table class="lv-table"><tr><th>신호</th><th>결과</th><th>읽는 법</th></tr>
      ${row("성급한 오답", sig.hasty.length ? "bad" : "good", sig.hasty.length + "개", "빨리 답하고 1점 이하. 그럴듯한 답을 따져 보지 않은 문항: " + qLinks(sig.hasty))}
      ${row("숙고한 정답", "good", sig.deliberate.length + "개", "오래 걸려 만점. 감점 대상이 아님: " + qLinks(sig.deliberate))}
      ${row("함정에서 멈췄나", sig.traps.some((x) => x.missed) ? "bad" : "good", sig.traps.filter((x) => x.missed).length + "개 놓침", "함정형 문항에 쓴 시간(중앙값 대비): " + trap)}
      ${row("답 수정", e.down ? "bad" : "mid", "오름 " + e.up + ", 내림 " + e.down, "뒤 문항을 본 뒤 고칠 수 있어 오른 것은 가산하지 않음. 고쳐서 내려간 문항: " + qLinks(e.regress))}
      ${row("시간에 쫓김", sig.rushed ? "bad" : "good", sig.rushed ? "그렇다" : "아니다", "마지막 3문항이 급했거나 미답이면 뒤 문항 점수는 실력보다 낮을 수 있음. 미답: " + qLinks(sig.unanswered))}
      ${row("찍기 의심", sig.quick.length >= 3 ? "bad" : "good", "10초 안 " + sig.quick.length + "개", "3개 이상이면 점수를 그대로 믿기 어려움: " + qLinks(sig.quick))}
      </table></div>`;
  }
  function levelHtml(lv) {
    if (!lv) return '<p class="muted small">연차 정보가 없어 연차 기대치 비교를 건너뜁니다.</p>';
    const cls = { "기대 이상": "good", "기대 수준": "mid", "기대 미달": "bad" };
    const rows = lv.dims.map((d) => `<tr><td><b>${esc(d.name)}</b></td><td>${num(d.got)} / ${d.max} (${Math.round(d.ratio * 100)}%)</td>
      <td>${Math.round(d.expect * 100)}% 이상</td><td><span class="chip ${cls[d.status]}">${d.status}</span></td></tr>`).join("");
    const warn = lv.warnings.map((w) => `<p class="lv-warn">${esc(w)}</p>`).join("");
    return `<div class="level card"><div class="lv-head"><b>연차 기대치 비교</b><span class="chip mid">${esc(lv.band.name)} (${lv.years}년차)</span></div>
      <p class="muted small">${esc(grading.levels.note)}</p>
      <table class="lv-table"><tr><th>영역</th><th>지원자</th><th>이 연차 기대</th><th>비교</th></tr>${rows}</table>${warn}</div>`;
  }
  function verdictHtml(sc) {
    const cls = sc.verdict === "면접 추천" ? "ok" : sc.verdict === "탈락 후보" ? "no" : "hold";
    return `<div class="hero ${cls}">
      <div class="hero-main"><span class="hero-score">${num(sc.total)}</span><span class="hero-max">/ ${sc.max}점</span></div>
      <div class="hero-side"><div class="hero-verdict">${esc(sc.verdict)}</div>
        <div class="hero-calc">문항 점수 <b>${num(sc.raw)}</b>${sc.penalty ? ` − 답 조합 감점 <b class="neg">${num(sc.penalty)}</b>` : " (답 조합 감점 없음)"}</div></div>
    </div><p class="muted small">${esc(grading.verdict.note)}</p>`;
  }
  function combosHtml(sc) {
    if (!sc.combos.length) return `<section class="sec"><h3><span class="sno">2</span>답 조합 감점</h3><p class="good-note">걸린 조합이 없습니다.</p></section>`;
    const title = (qid) => (qById(qid) || {}).title || qid;
    const cards = sc.combos.map((c) => `<div class="combo ${c.critical ? "critical" : ""} ${c.applied ? "" : "off"}">
      <div class="qhead"><span class="badge s0">−${num(c.penalty)}</span>
        <div class="qtitle"><b>${esc(c.title)}</b><span class="muted">관련 답: ${c.qs.map((q) => esc(E.questions.findIndex((x) => x.id === q) + 1 + "번 " + title(q))).join(", ")}</span></div>
        ${c.critical ? '<span class="tag">위험 조합</span>' : ""}
        <label class="no-print apply"><input type="checkbox" data-combo="${c.id}" ${c.applied ? "checked" : ""}> 감점 적용</label>
        <span class="print-only">${c.applied ? "적용" : "면접관이 적용 안 함"}</span>${c.merged ? '<span class="chip mid">같은 답에서 나온 조합이라 감점은 한 번만</span>' : ""}</div>
      <p class="ripple"><span class="lbl">파급효과</span>${esc(c.ripple)}</p></div>`).join("");
    const nCrit = sc.combos.filter((c) => c.critical && c.applied).length;
    const cap = `위험 조합 ${nCrit}건, 일반 조합 ${sc.combos.length - sc.combos.filter((c) => c.critical).length}건` + (grading.comboCap ? `, 감점 합계는 최대 ${grading.comboCap}점` : "");
    return `<section class="sec"><h3><span class="sno">2</span>답 조합 감점 <span class="muted">(${cap})</span></h3>
      <p class="muted small">문항 하나씩은 그럴듯해도 함께 고르면 나중에 문제가 커지는 조합입니다. 위험 조합이 하나라도 적용되면 점수와 관계없이 추천하지 않습니다.</p>${cards}</section>`;
  }
  function followHtml(f, i) {
    const memo = state.fmemo[f.id] || "";
    return `<div class="follow card"><div class="fhead"><span class="fno">Q${i + 1}</span><span class="src">${esc(f.source)}</span>${f.first ? '<span class="chip good">먼저 물을 질문</span>' : '<span class="chip mid">시간이 남으면</span>'}</div>
      <p class="fq">${esc(f.q)}</p>
      <dl class="fdl"><dt class="i">의도</dt><dd>${esc(f.intent)}</dd><dt class="e">기대 답</dt><dd>${esc(f.expect)}</dd><dt class="f">나쁜 신호</dt><dd>${esc(f.flag)}</dd></dl>
      <textarea data-fmemo="${f.id}" rows="2" placeholder="면접 메모">${esc(memo)}</textarea><div class="print-memo">${esc(memo)}</div></div>`;
  }
  function metaHtml() {
    const mins = state.endedAt ? Math.round((state.endedAt - state.startedAt) / 60000) : "-";
    const away = state.away.count ? `<b class="neg">${state.away.count}회, ${Math.round(state.away.ms / 1000)}초</b>` : "없음";
    const sub = state.endedAt ? fmt(state.endedAt, true).slice(11) + (state.autoSubmitted ? " (시간 종료 자동)" : "") : "미제출";
    return `<div class="meta-grid">
      <div><span>시험일</span><b>${fmt(state.startedAt)}</b></div><div><span>시작</span><b>${fmt(state.startedAt, true).slice(11)}</b></div>
      <div><span>제출</span><b>${esc(sub)}</b></div><div><span>소요</span><b>${mins}분</b></div>
      <div><span>다른 창 이동</span>${away}</div><div><span>개발 연차</span><b>${state.years != null ? state.years + "년" : "-"}</b></div></div>`;
  }
  function resultsHtml() {
    if (!grading) return lockHtml();
    if (grading.version !== E.version) return `<div class="card warn-box">채점 파일(${esc(grading.version)})과 문제(${esc(E.version)})의 판이 다릅니다.</div>`;
    if (state.phase === "intro") return '<div class="card">아직 시작한 시험이 없습니다.</div>';
    const sc = Scoring.scoreAll(grading, state.answers, state.overrides, state.comboOff);
    const sig = Scoring.timeSignals(grading, sc, state.visits);
    const fus = Scoring.selectFollowups(grading, sc, state.answers, 2, state.years, sig);
    const lv = Scoring.levelReport(grading, sc, state.years);
    sc.longest = longestQ();
    return `<div class="results">
      <div class="toolbar no-print"><button class="primary" data-act="pdf">PDF로 저장</button><button data-act="json">JSON 내보내기</button><button class="danger" data-act="reset">다음 지원자 준비(초기화)</button></div>
      ${state.phase === "exam" ? `<p class="lv-warn">시험 진행 중입니다(답 ${Object.keys(state.answers).length}/${E.questions.length}, 미제출). 아래 점수는 미완성입니다.</p>` : ""}
      <h2 class="rtitle">${esc(state.name)} <span class="muted">${state.years != null ? state.years + "년차, " : ""}평가 결과</span></h2>
      ${metaHtml()}
      <section class="sec"><h3><span class="sno">1</span>판정 초안</h3>${verdictHtml(sc)}${reliabilityHtml(sig)}${overviewHtml(sc)}</section>
      ${combosHtml(sc)}
      <section class="sec"><h3><span class="sno">3</span>영역별 점수</h3>${dimsHtml(sc)}${levelHtml(lv)}${signalsHtml(sig)}</section>
      <section class="sec"><h3><span class="sno">4</span>대면면접 추가질문</h3>${fus.map(followHtml).join("")}</section>
      <section class="sec"><h3><span class="sno">5</span>문항별 답과 점수</h3><p class="muted small">${esc(grading.terms || "")}</p><p class="legend"><span class="chip good">높은 점수</span><span class="chip mid">중간</span><span class="chip bad">0점</span><span class="best">정답</span><span class="pick">고름</span></p>${E.questions.map((q, i) => qResultHtml(q, i, sc)).join("")}</section>
      <section class="sec"><h3><span class="sno">6</span>종합 메모</h3><textarea data-memo rows="4" placeholder="면접관 종합 의견">${esc(state.memo)}</textarea><div class="print-memo">${esc(state.memo)}</div></section>
      <p class="muted small">자동 점수는 규칙으로 낸 초안입니다. 최종 판단은 면접관이 합니다.</p>
    </div>`;
  }

  /* ---------- 내보내기 ---------- */
  function baseName() {
    return "채용과제_평가결과_" + (state.name || "이름없음").replace(/[\\/:*?"<>|\s]+/g, "_") + "_" + fmt(state.startedAt || Date.now());
  }
  function toPdf() {
    state.saved = true;
    save();
    const old = document.title;
    const closed = [...document.querySelectorAll("details:not([open])")];
    closed.forEach((d) => (d.open = true));
    document.title = baseName();
    window.print();
    setTimeout(() => {
      document.title = old;
      closed.forEach((d) => (d.open = false));
    }, 1000);
  }
  function toJson() {
    const sc = Scoring.scoreAll(grading, state.answers, state.overrides, state.comboOff);
    const blob = new Blob([JSON.stringify({ version: E.version, state, score: sc }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = baseName() + ".json";
    state.saved = true;
    save();
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function reset() {
    const who = state.name || "지원자";
    const msg = state.phase === "exam"
      ? who + " 님이 아직 시험 중입니다(미제출). 지우면 되돌릴 수 없습니다. 정말 지울까요?"
      : state.saved ? who + " 님의 기록을 지웁니다. 되돌릴 수 없습니다."
      : who + " 님의 결과를 아직 PDF나 JSON으로 저장하지 않았습니다. 지우면 되돌릴 수 없습니다. 그래도 지울까요?";
    if (!confirm(msg)) return;
    grading = null;
    state = fresh();
    save();
    tab = "exam";
    render();
  }

  /* ---------- 렌더, 이벤트 ---------- */
  function headerHtml() {
    const done = Object.keys(state.answers).length;
    const status = state.phase === "exam" ? `<span id="timer" class="timer"></span><span class="muted">답 ${done}/${E.questions.length}</span>`
      : state.phase === "done" ? '<span class="muted">제출 완료</span>' : "";
    return `<div class="brand">${esc(E.title)}${state.name ? " | " + esc(state.name) : ""}</div>
      <div class="status">${status}</div>
      <nav class="tabs"><button class="${tab === "exam" ? "on" : ""}" data-tab="exam">시험</button><button class="${tab === "results" ? "on" : ""}" data-tab="results">평가 결과</button></nav>`;
  }
  function render() {
    const keep = [...document.querySelectorAll(".pane, .pane-scroll")].map((el) => el.scrollTop);
    $("#header").innerHTML = headerHtml();
    $("#main").innerHTML = tab === "exam" ? examHtml() : resultsHtml();
    document.querySelectorAll(".pane, .pane-scroll").forEach((el, i) => (el.scrollTop = keep[i] || 0));
    tick();
  }
  const actions = { start, unlock, submit: () => submit(false), pdf: toPdf, json: toJson, reset };
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act],[data-tab]");
    if (!t) return;
    if (t.dataset.tab) {
      // 결과 탭을 떠나면 다시 잠근다: 지원자가 탭만 눌러 정답을 보는 것 방지
      if (tab === "results" && t.dataset.tab !== "results") grading = null;
      tab = t.dataset.tab;
      return render();
    }
    const act = t.dataset.act;
    if (act === "send") return send(t.dataset.q);
    if (act === "cancel") {
      state.editing = null;
      clockTo(currentQ());
      save();
      return render();
    }
    if (act === "edit") {
      if (state.editing && state.editing !== t.dataset.q) return alert("고치던 답이 있어요. 먼저 「보내기」나 「취소」를 눌러 주세요.");
      state.editing = t.dataset.q;
      clockTo(t.dataset.q);
      save();
      return render();
    }
    if (actions[act]) actions[act]();
  });
  document.addEventListener("change", (e) => {
    const form = e.target.closest(".answer-form");
    const lim = form ? Number(form.dataset.limit) : 0;
    if (lim && e.target.type === "checkbox" && form.querySelectorAll("input:checked").length > lim) {
      e.target.checked = false;
      return;
    }
    if (e.target.dataset.combo !== undefined) {
      state.comboOff[e.target.dataset.combo] = !e.target.checked;
      save();
      return render();
    }
    if (e.target.dataset.ov !== undefined) {
      const v = e.target.value;
      if (v === "") delete state.overrides[e.target.dataset.ov];
      else state.overrides[e.target.dataset.ov] = Number(v);
      save();
      render();
    }
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.fmemo !== undefined) state.fmemo[t.dataset.fmemo] = t.value;
    else if (t.dataset.memo !== undefined) state.memo = t.value;
    else return;
    t.nextElementSibling.textContent = t.value;
    save();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "pw") unlock();
    if (e.key === "Enter" && e.target.id === "name") start();
  });
  document.addEventListener("visibilitychange", onAway);
  setInterval(tick, 1000);
  render();
  scrollToCurrent();
})();

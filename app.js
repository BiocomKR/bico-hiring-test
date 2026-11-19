/* 시험 진행, 결과 탭. 답은 이 브라우저의 localStorage 에만 저장된다. */
(function () {
  const E = window.EXAM;
  const KEY = "bico-exam-" + E.version;
  const DUR = E.durationMin * 60 * 1000;
  const $ = (sel) => document.querySelector(sel);
  let state = load();
  state.comboOff = state.comboOff || {};
  let grading = null;
  let tab = "exam";

  function fresh() {
    return { phase: "intro", name: "", answers: {}, edits: {}, revealed: 1, editing: null,
      away: { count: 0, ms: 0, since: null }, overrides: {}, comboOff: {}, fmemo: {}, memo: "" };
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
      t.textContent = "남은 시간 " + m + ":" + String(s).padStart(2, "0");
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
    if (!name) return alert("이름을 입력해 주세요.");
    Object.assign(state, { phase: "exam", name, startedAt: Date.now() });
    save();
    render();
  }
  function readForm(q) {
    const etc = ($("#etc-" + q.id) || {}).value || "";
    if (q.type === "cards" || q.type === "multi") {
      const picked = [...document.querySelectorAll("input[name=opt-" + q.id + "]:checked")].map((i) => i.value);
      return q.type === "cards" ? { cards: picked, etc } : { options: picked, etc };
    }
    const sel = document.querySelector("input[name=opt-" + q.id + "]:checked");
    return { option: sel ? sel.value : null, etc };
  }
  function validate(q, a) {
    if (q.type === "cards") {
      if (a.cards.length !== q.pick) return "카드를 " + q.pick + "장 골라 주세요.";
      return confirm("카드를 열면 바꿀 수 없어요. 이 3장을 열까요?") ? null : "";
    }
    const empty = !a.etc.trim() && (q.type === "multi" ? !a.options.length : !a.option);
    return empty ? "선택지를 고르거나 기타에 적어 주세요." : null;
  }
  function send(qid) {
    const q = qById(qid);
    const a = readForm(q);
    const err = validate(q, a);
    if (err) return err && alert(err);
    if (state.answers[qid]) state.edits[qid] = (state.edits[qid] || 0) + 1;
    state.answers[qid] = a;
    state.editing = null;
    const idx = E.questions.indexOf(q);
    state.revealed = Math.max(state.revealed, Math.min(idx + 2, E.questions.length));
    save();
    render();
    const chat = $("#chat");
    if (chat) chat.scrollTop = chat.scrollHeight;
  }
  function submit(auto) {
    if (!auto && !confirm("최종 제출할까요? 제출하면 더 고칠 수 없어요.")) return;
    if (state.away.since) {
      state.away.ms += Date.now() - state.away.since;
      state.away.since = null;
    }
    Object.assign(state, { phase: "done", endedAt: Date.now(), autoSubmitted: !!auto, editing: null });
    save();
    render();
  }

  /* ---------- 지원자 화면 ---------- */
  function introHtml() {
    return `<section class="intro card">
      <h2>${esc(E.title)}</h2>
      <ul class="rules">${E.rules.map((r) => "<li>" + esc(r) + "</li>").join("")}</ul>
      <label class="field">지원자 이름<input id="name" autocomplete="off" placeholder="이름을 입력하세요"></label>
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
  function inputHtml(q) {
    const a = state.answers[q.id] || {};
    const isMulti = q.type !== "single";
    const items = q.type === "cards" ? q.cards.map((c) => ({ id: c.id, text: c.label })) : q.options;
    const chosen = a.cards || a.options || (a.option ? [a.option] : []);
    const opts = items.map((o) => `<label class="opt"><input type="${isMulti ? "checkbox" : "radio"}" name="opt-${q.id}" value="${o.id}" ${chosen.includes(o.id) ? "checked" : ""}><span>${esc(o.text)}</span></label>`).join("");
    const hint = q.type === "cards" ? q.pick + "장을 고르세요." : q.type === "multi" ? "해당하는 것을 모두 고르세요." : "하나를 고르세요.";
    return `<div class="answer-form">
      <p class="hint">${hint} 기타는 선택입니다.</p>${opts}
      <label class="etc">기타<textarea id="etc-${q.id}" rows="3" placeholder="${esc(q.etcLabel)}">${esc(a.etc || "")}</textarea></label>
      <button class="primary" data-act="send" data-q="${q.id}">보내기</button>
    </div>`;
  }
  function answerText(q, a) {
    const items = q.type === "cards" ? q.cards.map((c) => ({ id: c.id, text: c.label })) : q.options;
    const ids = a.cards || a.options || (a.option ? [a.option] : []);
    const lines = ids.map((id) => "• " + (items.find((o) => o.id === id) || {}).text);
    if (a.etc && a.etc.trim()) lines.push("기타: " + a.etc.trim());
    return lines.join("\n");
  }
  function questionHtml(q, i) {
    const a = state.answers[q.id];
    const editable = state.phase === "exam" && !(q.lockOnSend && a);
    let body;
    if (state.phase === "exam" && (!a || state.editing === q.id)) body = inputHtml(q);
    else body = `<div class="bubble me">${esc(answerText(q, a || {})) || "(답 없음)"}${editable ? `<button class="link" data-act="edit" data-q="${q.id}">수정</button>` : ""}</div>`;
    return `<div class="turn"><div class="bubble ai"><span class="who">AI 동료 (${i + 1}/${E.questions.length}) ${esc(q.title)}</span>${esc(q.ai)}</div>${body}</div>`;
  }
  function chatHtml() {
    const shown = E.questions.slice(0, state.phase === "done" ? E.questions.length : state.revealed);
    let html = shown.map(questionHtml).join("");
    const allDone = E.questions.every((q) => state.answers[q.id]);
    if (state.phase === "exam" && allDone && !state.editing) {
      html += `<div class="turn"><div class="bubble ai"><span class="who">AI 동료</span>모든 질문에 답했어요. 고칠 답이 있으면 「수정」을 누르고, 다 됐으면 최종 제출해 주세요.</div>
        <button class="primary" data-act="submit">최종 제출</button></div>`;
    }
    if (state.phase === "done") html += `<div class="done card">제출이 끝났습니다. 감독관에게 알려 주세요.</div>`;
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
  function choiceHtml(q, a, r) {
    if (!a) return '<p class="muted">답하지 않음</p>';
    const items = q.type === "cards" ? q.cards.map((c) => ({ id: c.id, text: c.label })) : q.options;
    const ids = a.cards || a.options || (a.option ? [a.option] : []);
    const g = grading.questions[q.id];
    const tag = (id) => {
      if (g.kind === "single") return " (" + (g.options[id] || 0) + "점)";
      if (g.kind === "multi") return g.flaws.includes(id) ? " (결함 맞힘)" : " (결함 아님, 감점)";
      return g.high.includes(id) ? " (핵심 카드)" : "";
    };
    const list = ids.map((id) => "<li>" + esc((items.find((o) => o.id === id) || {}).text) + "<b>" + tag(id) + "</b></li>").join("");
    const etc = a.etc && a.etc.trim()
      ? `<div class="etc-box"><b>기타 (규칙 ${r.etcScore}점)</b><p>${esc(a.etc)}</p><p class="muted">걸린 핵심어: ${r.hits.length ? esc(r.hits.join(", ")) : "없음"}</p></div>` : "";
    return "<ul>" + list + "</ul>" + etc;
  }
  function qResultHtml(q, i, sc) {
    const g = grading.questions[q.id];
    const r = sc.per[q.id];
    const ov = state.overrides[q.id];
    const sel = ["", 0, 1, 2, 3].map((v) => `<option value="${v}" ${String(ov ?? "") === String(v) ? "selected" : ""}>${v === "" ? "자동(" + r.auto + ")" : v + "점"}</option>`).join("");
    return `<div class="qres card">
      <div class="qhead"><b>${i + 1}. ${esc(q.title)}</b><span class="muted">${esc(g.type || "")}</span>
        <span class="score">자동 ${r.auto}점, 면접관 <select data-ov="${q.id}">${sel}</select><b class="print-only">최종 ${r.final}점</b></span></div>
      ${choiceHtml(q, state.answers[q.id], r)}
      ${state.edits[q.id] ? `<p class="muted">수정 ${state.edits[q.id]}회</p>` : ""}
      <details><summary>모범 답과 채점 기준</summary><p>${esc(g.model)}</p>${g.why ? "<p>" + esc(g.why) + "</p>" : ""}</details>
    </div>`;
  }
  function combosHtml(sc) {
    if (!sc.combos.length) return "";
    const title = (qid) => (qById(qid) || {}).title || qid;
    const cards = sc.combos.map((c) => `<div class="combo card ${c.critical ? "critical" : ""} ${c.applied ? "" : "off"}">
      <div class="qhead"><b>${esc(c.title)}</b>${c.critical ? '<span class="tag">위험 조합</span>' : ""}
        <span class="score"><label class="no-print"><input type="checkbox" data-combo="${c.id}" ${c.applied ? "checked" : ""}> 감점 적용</label>
        <b>−${c.penalty}점</b><span class="print-only">${c.applied ? "적용" : "면접관이 적용 안 함"}</span></span></div>
      <p class="muted">관련 답: ${c.qs.map((q) => esc(q.replace("q", "") + "번 " + title(q))).join(", ")}</p>
      <p><b>파급효과</b> ${esc(c.ripple)}</p></div>`).join("");
    const cap = grading.comboCap ? ` (감점은 최대 ${grading.comboCap}점)` : "";
    return `<h3>답 조합 감점${cap}</h3><p class="muted">문항 하나씩은 그럴듯해도 함께 고르면 나중에 문제가 커지는 조합입니다. 위험 조합이 하나라도 적용되면 점수와 관계없이 추천하지 않습니다.</p>${cards}`;
  }
  function followHtml(f) {
    const memo = state.fmemo[f.id] || "";
    return `<div class="follow card"><p class="muted">${esc(f.source)}</p><p class="fq">${esc(f.q)}</p>
      <p><b>의도</b> ${esc(f.intent)}</p><p><b>기대 답</b> ${esc(f.expect)}</p><p><b>나쁜 신호</b> ${esc(f.flag)}</p>
      <textarea data-fmemo="${f.id}" rows="2" placeholder="면접 메모">${esc(memo)}</textarea><div class="print-memo">${esc(memo)}</div></div>`;
  }
  function metaHtml() {
    const mins = state.endedAt ? Math.round((state.endedAt - state.startedAt) / 60000) : "-";
    return `<table class="meta">
      <tr><th>지원자</th><td>${esc(state.name)}</td><th>시험일</th><td>${fmt(state.startedAt)}</td></tr>
      <tr><th>시작</th><td>${fmt(state.startedAt, true)}</td><th>제출</th><td>${state.endedAt ? fmt(state.endedAt, true) + (state.autoSubmitted ? " (시간 종료 자동 제출)" : "") : "미제출"}</td></tr>
      <tr><th>소요</th><td>${mins}분</td><th>다른 창 이동</th><td>${state.away.count}회, ${Math.round(state.away.ms / 1000)}초</td></tr>
    </table>`;
  }
  function resultsHtml() {
    if (!grading) return lockHtml();
    if (grading.version !== E.version) return `<div class="card warn-box">채점 파일(${esc(grading.version)})과 문제(${esc(E.version)})의 판이 다릅니다.</div>`;
    if (state.phase === "intro") return '<div class="card">아직 시작한 시험이 없습니다.</div>';
    const sc = Scoring.scoreAll(grading, state.answers, state.overrides, state.comboOff);
    const fus = Scoring.selectFollowups(grading, sc, state.answers, 4);
    const dims = sc.dims.map((d) => `<tr><td>${esc(d.name)}</td><td>${d.got} / ${d.max}</td></tr>`).join("");
    return `<div class="results">
      <div class="toolbar no-print"><button class="primary" data-act="pdf">PDF로 저장</button><button data-act="json">JSON 내보내기</button><button class="danger" data-act="reset">다음 지원자 준비(초기화)</button></div>
      <h2>평가 결과: ${esc(state.name)} (${fmt(state.startedAt)})</h2>
      ${metaHtml()}
      <div class="verdict card"><div class="big">${sc.total} / ${sc.max}점, ${sc.verdict}</div>
        <p>문항 점수 ${sc.raw}점${sc.penalty ? ", 답 조합 감점 −" + sc.penalty + "점" : ", 답 조합 감점 없음"}</p>
        <p class="muted">${esc(grading.verdict.note)}</p></div>
      ${combosHtml(sc)}
      <h3>영역별 점수</h3><table class="dims"><tr><th>영역</th><th>점수</th></tr>${dims}</table>
      <h3>대면면접 추가질문</h3>${fus.map(followHtml).join("")}
      <h3>문항별 답과 점수</h3>${E.questions.map((q, i) => qResultHtml(q, i, sc)).join("")}
      <h3>종합 메모</h3><textarea data-memo rows="4" placeholder="면접관 종합 의견">${esc(state.memo)}</textarea><div class="print-memo">${esc(state.memo)}</div>
      <p class="muted">자동 점수는 규칙으로 낸 초안입니다. 최종 판단은 면접관이 합니다.</p>
    </div>`;
  }

  /* ---------- 내보내기 ---------- */
  function baseName() {
    return "채용과제_평가결과_" + (state.name || "이름없음").replace(/[\\/:*?"<>|\s]+/g, "_") + "_" + fmt(state.startedAt || Date.now());
  }
  function toPdf() {
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
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function reset() {
    if (!confirm("이 기기의 시험 기록을 지웁니다. PDF나 JSON으로 저장했나요?")) return;
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
      tab = t.dataset.tab;
      return render();
    }
    const act = t.dataset.act;
    if (act === "send") return send(t.dataset.q);
    if (act === "edit") {
      state.editing = t.dataset.q;
      save();
      return render();
    }
    if (actions[act]) actions[act]();
  });
  document.addEventListener("change", (e) => {
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
})();

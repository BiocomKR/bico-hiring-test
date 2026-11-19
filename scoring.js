/* 규칙 기반 채점. 브라우저와 node 시험에서 같이 쓴다. */
(function (root) {
  function scoreCards(qg, ans) {
    const picked = ans.cards || [];
    const sum = picked.reduce((s, c) => s + (qg.weights[c] || 0), 0);
    return { auto: Math.min(3, sum) };
  }

  function scoreMulti(qg, ans) {
    const picked = ans.options || [];
    const right = picked.filter((p) => qg.flaws.includes(p)).length;
    const wrong = picked.filter((p) => qg.fine.includes(p)).length;
    const step = qg.scale.find((s) => right - wrong >= s.min);
    return { auto: step ? step.score : 0, right, wrong };
  }

  // 정답 짝이 아니면 가장 높은 보기 점수에서 0점 보기 수만큼 뺀다
  function scorePick(qg, ans) {
    const picked = ans.options || [];
    if (!picked.length) return { auto: 0 };
    const key = [...picked].sort().join("+");
    if (qg.pairs[key] !== undefined) return { auto: qg.pairs[key], pair: true };
    const scores = picked.map((p) => qg.options[p] || 0);
    const bad = scores.filter((v) => v === 0).length;
    return { auto: Math.max(0, Math.max(...scores) - bad) };
  }

  function scoreSingle(qg, ans) {
    return { auto: ans.option != null ? qg.options[ans.option] || 0 : 0 };
  }

  const scorers = { cards: scoreCards, multi: scoreMulti, pick: scorePick, single: scoreSingle };

  function scoreQuestion(qg, ans) {
    if (!ans) return { auto: 0, unanswered: true };
    return scorers[qg.kind](qg, ans);
  }

  function scoreAll(grading, answers, overrides, comboOff) {
    const per = {};
    for (const qid of Object.keys(grading.questions)) {
      const r = scoreQuestion(grading.questions[qid], answers[qid]);
      const ov = overrides && overrides[qid];
      r.final = ov === undefined || ov === null || ov === "" ? r.auto : Number(ov);
      per[qid] = r;
    }
    const dims = grading.dims.map((d) => {
      const got = d.qs.reduce((s, q) => s + per[q].final, 0);
      return { id: d.id, name: d.name, got, max: d.qs.length * 3 };
    });
    const raw = dims.reduce((s, d) => s + d.got, 0);
    const max = dims.reduce((s, d) => s + d.max, 0);
    const combos = (grading.combos || [])
      .filter((c) => matches(c.when, per, answers))
      .map((c) => ({ ...c, applied: !(comboOff && comboOff[c.id]) }));
    const sum = combos.filter((c) => c.applied).reduce((s, c) => s + c.penalty, 0);
    const penalty = Math.min(sum, grading.comboCap ?? sum);
    const total = Math.max(0, raw - penalty);
    const critical = combos.some((c) => c.applied && c.critical);
    return { per, dims, raw, penalty, total, max, combos, verdict: verdictOf(grading.verdict, total, dims, critical) };
  }

  // 문항 하나뿐인 영역은 보기 하나로 갈리므로 하한에서 뺀다
  function verdictOf(v, total, dims, critical) {
    const floor = v.floorDims || dims.map((d) => d.id);
    const allFloor = dims.filter((d) => floor.includes(d.id)).every((d) => d.got * 3 >= d.max);
    if (total <= v.reject) return "탈락 후보";
    if (critical) return "보류 (위험한 답 조합)";
    if (total >= v.recommend && allFloor) return "면접 추천";
    return "보류";
  }

  function picked(ans) {
    if (!ans) return [];
    if (ans.options) return ans.options;
    if (ans.cards) return ans.cards;
    return ans.option != null ? [ans.option] : [];
  }

  function matches(when, per, answers) {
    if (when.all) return when.all.every((c) => matches(c, per, answers));
    if (when.any) return when.any.some((c) => matches(c, per, answers));
    const r = per[when.q];
    if (!r) return false;
    const got = picked(answers[when.q]);
    if (when.option && !got.some((o) => when.option.includes(o))) return false;
    if (when.notOption && got.some((o) => when.notOption.includes(o))) return false;
    if (when.maxScore !== undefined && r.final > when.maxScore) return false;
    if (when.minScore !== undefined && r.final < when.minScore) return false;
    return true;
  }

  function selectFollowups(grading, scored, answers, limit) {
    const specific = grading.followups
      .filter((f) => matches(f.when, scored.per, answers))
      .map((f, i) => ({ f, i, s: scored.per[f.when.q].final }))
      .sort((a, b) => a.s - b.s || a.i - b.i)
      .slice(0, limit || 4)
      .map((x) => x.f);
    const weakestDim = [...scored.dims].sort((a, b) => a.got / a.max - b.got / b.max)[0];
    const weak = grading.weakest[weakestDim.id];
    const combos = scored.combos.filter((c) => c.applied).slice(0, 2)
      .map((c) => ({ id: c.id, q: c.q, intent: c.intent, expect: c.expect, flag: c.flag, source: "답 조합: " + c.title }));
    const list = combos.concat(specific.map((f) => ({ ...f, source: "답 " + f.when.q.replace("q", "") + "번에 따라" })));
    if (weak) list.push({ id: "w-" + weakestDim.id, ...weak, source: "가장 약한 영역: " + weakestDim.name });
    grading.always.forEach((a) => list.push({ ...a, source: "공통" }));
    return list;
  }

  const api = { scoreQuestion, scoreAll, selectFollowups, verdictOf };
  root.Scoring = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

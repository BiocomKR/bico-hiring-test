// 실행: GRADING_JSON=<채점 원본 경로> node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../scoring.js");

const src = process.env.GRADING_JSON;
const G = src ? require(src) : null;
const opt = { skip: !G && "GRADING_JSON 없음" };
const q = (id, ans) => S.scoreQuestion(G.questions[id], ans).auto;

test("함정형: 그럴듯한 보기는 1점 이하, 최선의 보기만 3점", opt, () => {
  assert.equal(q("q3", { option: "a" }), 1);
  assert.equal(q("q3", { option: "e" }), 0.5);
  assert.equal(q("q5", { option: "e" }), 0);
  assert.equal(q("q3", { option: "d" }), 3);
  assert.equal(q("q5", { option: "d" }), 3);
});

test("기타는 자동 점수에 들어가지 않는다", opt, () => {
  assert.equal(q("q3", { option: "a", etc: "OCR로 읽고 간호사가 원본과 대조" }), 1);
  assert.equal(q("q4", { options: [], etc: "4주차 일부 운영, 나머지 순차" }), 0);
});

test("2개 고르기: 정답 짝이면 3점, 하나만 고르면 그 보기 점수", opt, () => {
  assert.equal(q("q4", { options: ["a", "b"] }), 3);
  assert.equal(q("q4", { options: ["b", "a"] }), 3);
  assert.equal(q("q4", { options: ["a"] }), 2);
  assert.equal(q("q6", { options: ["a", "d"] }), 3);
  assert.equal(q("q11", { options: ["a", "b"] }), 3);
});

test("2개 고르기: 틀린 보기를 섞으면 오히려 깎인다", opt, () => {
  assert.equal(q("q4", { options: ["a", "d"] }), 1);
  assert.equal(q("q8", { options: ["a", "c"] }), 1);
  assert.equal(q("q6", { options: ["c", "b"] }), 0);
});

test("2개 고르기: 정답이 아닌 짝은 표에 있는 점수만", opt, () => {
  assert.equal(q("q4", { options: ["b", "c"] }), 2);
  assert.equal(q("q11", { options: ["a", "c"] }), 2);
});

test("결함 찾기: 멀쩡한 항목을 고르면 감점", opt, () => {
  const all = ["p1", "p2", "p3", "p4", "p5", "p6", "p9"];
  assert.equal(q("q7", { options: all }), 3);
  assert.equal(q("q7", { options: [...all, "p7", "p8"] }), 2);
});

test("정보 카드: 카드별 점수 합, 최대 3", opt, () => {
  assert.equal(q("q1", { cards: ["c1", "c3", "c5"] }), 3);
  assert.equal(q("q1", { cards: ["c7", "c8", "c2"] }), 1.5);
  assert.equal(q("q1", { cards: ["c4", "c8", "c2"] }), 0.5);
});

test("2개 고르기: 서로 모순되는 짝은 낮은 점수", opt, () => {
  assert.equal(q("q4", { options: ["a", "e"] }), 1);
  assert.equal(q("q6", { options: ["a", "b"] }), 1);
  assert.equal(q("q9", { options: ["a", "b"] }), 1);
});

test("문항 하나뿐인 영역이 0점이어도 추천을 막지 않는다", opt, () => {
  const ans = fullMarks();
  ans.q10 = { option: "c" };
  assert.equal(S.scoreAll(G, ans, {}).verdict, "면접 추천");
});

test("식별정보를 가리지 않고 보내면 그 답 하나로 위험 조합", opt, () => {
  const sc = S.scoreAll(G, { q5: { option: "e" } }, {});
  assert.ok(sc.combos.some((c) => c.id === "k3" && c.critical));
});

test("자기 답끼리 모순되면 조합 감점", opt, () => {
  const ids = (ans) => S.scoreAll(G, ans, {}).combos.map((c) => c.id);
  assert.ok(ids({ qn: { options: ["n1"] } }).includes("k10"));
  assert.ok(!ids({ qn: { options: ["n1"] }, q7: { options: ["p5"] } }).includes("k10"));
  assert.ok(ids({ q3: { option: "e" }, q11: { options: ["b"] } }).includes("k11"));
  assert.ok(ids({ q3: { option: "d" }, q9: { options: ["a"] } }).includes("k12"));
  assert.ok(!ids({ q3: { option: "d" }, q9: { options: ["a", "b"] } }).includes("k12"));
});

test("면접관 점수가 자동 점수를 대신하고 판정에 반영", opt, () => {
  const a = { q10: { option: "a" } };
  const base = S.scoreAll(G, a, {});
  const ov = S.scoreAll(G, a, { q3: 3 });
  assert.equal(ov.total - base.total, 3);
});

test("답이 없으면 탈락 후보, 공통 추가질문은 항상 나온다", opt, () => {
  const sc = S.scoreAll(G, {}, {});
  assert.equal(sc.verdict, "탈락 후보");
  const f = S.selectFollowups(G, sc, {}, 4);
  assert.ok(f.some((x) => x.id === "a1"));
  assert.ok(f.some((x) => x.id.startsWith("w-")));
});

test("고른 보기에 맞는 추가질문이 나온다", opt, () => {
  const ans = { q3: { option: "a" } };
  const ids = S.selectFollowups(G, S.scoreAll(G, ans, {}), ans, 10).map((x) => x.id);
  assert.ok(ids.includes("f3"));
  assert.ok(!ids.includes("f4"));
});

test("정답 짝을 고르면 그 문항의 보기 기반 추가질문은 나오지 않는다", opt, () => {
  const ans = { q6: { options: ["a", "d"] } };
  const ids = S.selectFollowups(G, S.scoreAll(G, ans, {}), ans, 10).map((x) => x.id);
  assert.ok(!ids.includes("f12"));
});

test("추가질문은 점수가 낮은 문항부터 고른다", opt, () => {
  const ans = fullMarks();
  ans.q2 = { slots: { who: "a", where: "b", what: "a" } };
  ans.q10 = { option: "c" };
  const f = S.selectFollowups(G, S.scoreAll(G, ans, {}), ans, 1).filter((x) => x.id.startsWith("f"));
  assert.equal(f[0].id, "f17");
});

test("잘못된 답 조합은 감점되고 파급효과가 나온다", opt, () => {
  const ans = { q3: { option: "a" }, q6: { options: ["b"] } };
  const sc = S.scoreAll(G, ans, {});
  const k = sc.combos.find((c) => c.id === "k1");
  assert.ok(k && k.applied && k.ripple.length > 0);
  assert.equal(sc.raw - sc.penalty, sc.total);
});

test("한쪽만 틀리면 조합 감점은 없다", opt, () => {
  const sc = S.scoreAll(G, { q3: { option: "a" }, q6: { options: ["a"] } }, {});
  assert.ok(!sc.combos.some((c) => c.id === "k1"));
});

test("결함 찾기에서 고친 항목은 조합 조건에서 빠진다", opt, () => {
  const bad = S.scoreAll(G, { q8: { options: ["c"] } }, {});
  const fixed = S.scoreAll(G, { q8: { options: ["c"] }, q7: { options: ["p5"] } }, {});
  assert.ok(bad.combos.some((c) => c.id === "k4"));
  assert.ok(!fixed.combos.some((c) => c.id === "k4"));
});

test("매칭에서 확인 대기까지 고르면 되돌릴 수 없음 조합은 없다", opt, () => {
  const bad = S.scoreAll(G, { q6: { options: ["a"] }, q9: { options: ["a"] } }, {});
  const ok = S.scoreAll(G, { q6: { options: ["a", "d"] }, q9: { options: ["a"] } }, {});
  assert.ok(bad.combos.some((c) => c.id === "k9"));
  assert.ok(!ok.combos.some((c) => c.id === "k9"));
});

test("면접관이 조합 감점을 끄면 총점에서 빠진다", opt, () => {
  const ans = { q3: { option: "a" }, q6: { options: ["b"] } };
  const on = S.scoreAll(G, ans, {});
  const off = S.scoreAll(G, ans, {}, { k1: true });
  assert.equal(off.total - on.total, on.combos.find((c) => c.id === "k1").penalty);
});

test("조합 감점은 상한이 있고 총점은 0 아래로 내려가지 않는다", opt, () => {
  const ans = {
    q2: { option: "b" }, q3: { option: "a" }, q4: { options: ["d"] }, q5: { option: "b" },
    q6: { options: ["b"] }, q8: { options: ["c"] }, q9: { options: ["a"] }, q11: { options: ["b"] }
  };
  const sc = S.scoreAll(G, ans, {});
  assert.ok(sc.penalty <= G.comboCap);
  assert.ok(sc.total >= 0);
});

test("위험 조합이 있으면 점수가 높아도 추천하지 않는다", opt, () => {
  const ans = fullMarks();
  ans.q5 = { option: "b" };
  ans.q6 = { options: ["c"] };
  const sc = S.scoreAll(G, ans, { q5: 3, q6: 3 });
  assert.ok(sc.combos.some((c) => c.id === "k3" && c.critical));
  assert.notEqual(sc.verdict, "면접 추천");
});

test("조합 추가질문이 먼저 나온다", opt, () => {
  const ans = { q3: { option: "a" }, q6: { options: ["b"] } };
  const f = S.selectFollowups(G, S.scoreAll(G, ans, {}), ans, 4);
  assert.equal(f[0].id, "o1");
  assert.equal(f[1].id, "k1");
});

test("연차로 구간을 고른다", opt, () => {
  assert.equal(S.levelReport(G, S.scoreAll(G, {}, {}), 0).band.id, "junior");
  assert.equal(S.levelReport(G, S.scoreAll(G, {}, {}), 3).band.id, "mid");
  assert.equal(S.levelReport(G, S.scoreAll(G, {}, {}), 12).band.id, "senior");
  assert.equal(S.levelReport(G, S.scoreAll(G, {}, {}), null), null);
});

test("연차는 판정을 바꾸지 않는다", opt, () => {
  const ans = fullMarks();
  ans.q9 = { options: ["a"] };
  const sc = S.scoreAll(G, ans, {});
  const before = sc.verdict;
  S.levelReport(G, sc, 15);
  assert.equal(sc.verdict, before);
});

test("같은 점수라도 연차에 따라 기대 미달이 갈린다", opt, () => {
  const ans = fullMarks();
  ans.q9 = { options: ["a"] };
  ans.q8 = { options: ["a"] };
  const sc = S.scoreAll(G, ans, {});
  const d6 = (y) => S.levelReport(G, sc, y).dims.find((d) => d.id === "D6").status;
  assert.equal(d6(1), "기대 이상");
  assert.equal(d6(10), "기대 미달");
});

test("시니어가 위험 조합에 걸리면 경고가 붙는다", opt, () => {
  const sc = S.scoreAll(G, { q5: { option: "b" } }, {});
  assert.ok(S.levelReport(G, sc, 10).warnings.length > 0);
  assert.equal(S.levelReport(G, sc, 1).warnings.length, 0);
});

test("연차 맞춤 추가질문이 붙는다", opt, () => {
  const sc = S.scoreAll(G, {}, {});
  const f = S.selectFollowups(G, sc, {}, 4, 10);
  assert.ok(f.some((x) => x.id === "lv-senior"));
});

test("조합 질문과 같은 문항의 질문은 겹쳐 나오지 않는다", opt, () => {
  const ans = { q5: { option: "b" } };
  const ids = S.selectFollowups(G, S.scoreAll(G, ans, {}), ans, 10).map((x) => x.id);
  assert.ok(ids.includes("k3"));
  assert.ok(!ids.includes("f10"));
});

test("문장 조립: 칸마다 1점", opt, () => {
  assert.equal(q("q2", { slots: { who: "a", where: "b", what: "b" } }), 3);
  assert.equal(q("q2", { slots: { who: "b", where: "a", what: "a" } }), 0);
  assert.equal(q("q2", { slots: { who: "a", where: "b", what: "a" } }), 2);
});

test("하지 않을 것: 꼭 해야 할 일을 빼면 감점", opt, () => {
  assert.equal(q("qn", { options: ["n1", "n2", "n3", "n7"] }), 3);
  assert.equal(q("qn", { options: ["n1", "n2", "n3", "n7", "n6"] }), 2);
  assert.equal(q("qn", { options: ["n1", "n2", "n3", "n4", "n5", "n6", "n7"] }), 0);
});

test("정보 수집: 질문 다듬기와 성립 조건 확인", opt, () => {
  assert.equal(q("qa", { option: "b" }), 3);
  assert.equal(q("qa", { option: "d" }), 0);
  assert.equal(q("qc", { options: ["a", "b"] }), 3);
  assert.equal(q("qc", { options: ["a", "e"] }), 1);
});

const sec = (n) => n * 1000;
function visitsOf(ans, times) {
  return Object.fromEntries(Object.keys(ans).map((q) => [q, [{ ms: sec(times[q] ?? 60), answer: ans[q] }]]));
}

test("성급한 오답: 본인 중앙값의 절반보다 빨리 답하고 1점 이하", opt, () => {
  const ans = fullMarks();
  ans.q5 = { option: "b" };
  const sc = S.scoreAll(G, ans, {});
  const sig = S.timeSignals(G, sc, visitsOf(ans, { q5: 20 }));
  assert.deepEqual(sig.hasty, ["q5"]);
  assert.ok(sig.traps.find((x) => x.qid === "q5").missed);
  assert.equal(S.timeSignals(G, sc, visitsOf(ans, { q5: 70 })).hasty.length, 0);
});

test("숙고한 정답은 따로 세고 감점하지 않는다", opt, () => {
  const ans = fullMarks();
  const sc = S.scoreAll(G, ans, {});
  const sig = S.timeSignals(G, sc, visitsOf(ans, { q3: 200 }));
  assert.deepEqual(sig.deliberate, ["q3"]);
  assert.equal(sc.total, 42);
});

test("수정의 질: 고쳐서 내려간 문항을 찾고 추가질문을 붙인다", opt, () => {
  const ans = fullMarks();
  ans.q6 = { options: ["b"] };
  const v = visitsOf(ans, {});
  v.q6 = [{ ms: sec(60), answer: { options: ["a", "d"] } }, { ms: sec(30), answer: ans.q6 }];
  v.q9 = [{ ms: sec(40), answer: { options: ["a"] } }, { ms: sec(30), answer: ans.q9 }];
  const sc = S.scoreAll(G, ans, {});
  const sig = S.timeSignals(G, sc, v);
  assert.equal(sig.edits.down, 1);
  assert.equal(sig.edits.up, 1);
  assert.deepEqual(sig.edits.regress, ["q6"]);
  const f = S.selectFollowups(G, sc, ans, 4, 5, sig);
  assert.ok(f.some((x) => x.id === "ed-q6"));
});

test("찍기 의심과 시간에 쫓김은 신뢰도를 낮춘다", opt, () => {
  const ans = fullMarks();
  const sc = S.scoreAll(G, ans, {});
  assert.equal(S.timeSignals(G, sc, visitsOf(ans, {})).reliability.low, false);
  assert.ok(S.timeSignals(G, sc, visitsOf(ans, { q3: 5, q4: 6, q5: 7 })).reliability.low);
  const partial = fullMarks();
  delete partial.q11;
  const sc2 = S.scoreAll(G, partial, {});
  const sig = S.timeSignals(G, sc2, visitsOf(partial, {}));
  assert.ok(sig.rushed && sig.reliability.low);
});

test("성급한 오답 문항의 추가질문이 먼저 나온다", opt, () => {
  const ans = fullMarks();
  ans.q10 = { option: "c" };
  ans.q5 = { option: "c" };
  const sc = S.scoreAll(G, ans, {});
  const sig = S.timeSignals(G, sc, visitsOf(ans, { q5: 10 }));
  const f = S.selectFollowups(G, sc, ans, 1, null, sig).filter((x) => /^f\d/.test(x.id));
  assert.equal(f[0].id, "f9");
});

function fullMarks() {
  return {
    q1: { cards: ["c1", "c3", "c5"] }, qa: { option: "b" }, q2: { slots: { who: "a", where: "b", what: "b" } },
    qc: { options: ["a", "b"] }, qn: { options: ["n1", "n2", "n3", "n7"] }, q3: { option: "d" },
    q4: { options: ["a", "b"] }, q5: { option: "d" }, q6: { options: ["a", "d"] },
    q7: { options: ["p1", "p2", "p3", "p4", "p5", "p6", "p9"] }, q8: { options: ["a", "d"] },
    q9: { options: ["b", "c"] }, q10: { option: "a" }, q11: { options: ["a", "b"] }
  };
}

test("만점 답안은 면접 추천", opt, () => {
  const sc = S.scoreAll(G, fullMarks(), {});
  assert.equal(sc.total, 42);
  assert.equal(sc.combos.length, 0);
  assert.equal(sc.verdict, "면접 추천");
});

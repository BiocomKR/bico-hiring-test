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
  assert.equal(q("q3", { option: "e" }), 1);
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

test("정보 카드: 반전 카드 수가 점수, 최대 3", opt, () => {
  assert.equal(q("q1", { cards: ["c1", "c3", "c5"] }), 3);
  assert.equal(q("q1", { cards: ["c4", "c8", "c2"] }), 0);
});

test("면접관 점수가 자동 점수를 대신하고 판정에 반영", opt, () => {
  const a = { q2: { option: "c" } };
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
  const ans = {
    q1: { cards: ["c1", "c3", "c5"] }, q7: { options: ["p1", "p2", "p3", "p4", "p5", "p6", "p9"] },
    q2: { option: "a" }, q10: { option: "c" }
  };
  const f = S.selectFollowups(G, S.scoreAll(G, ans, {}), ans, 1);
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
  assert.equal(f[0].id, "k1");
});

function fullMarks() {
  return {
    q1: { cards: ["c1", "c3", "c5"] }, q2: { option: "c" }, q3: { option: "d" },
    q4: { options: ["a", "b"] }, q5: { option: "d" }, q6: { options: ["a", "d"] },
    q7: { options: ["p1", "p2", "p3", "p4", "p5", "p6", "p9"] }, q8: { options: ["a", "d"] },
    q9: { options: ["b", "c"] }, q10: { option: "a" }, q11: { options: ["a", "b"] }
  };
}

test("만점 답안은 면접 추천", opt, () => {
  const sc = S.scoreAll(G, fullMarks(), {});
  assert.equal(sc.total, 33);
  assert.equal(sc.combos.length, 0);
  assert.equal(sc.verdict, "면접 추천");
});

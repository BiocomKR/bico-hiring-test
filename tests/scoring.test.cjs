// 실행: GRADING_JSON=<채점 원본 경로> node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../scoring.js");

const src = process.env.GRADING_JSON;
const G = src ? require(src) : null;
const opt = { skip: !G && "GRADING_JSON 없음" };

test("함정형: 선택지만 고르면 1점 이하", opt, () => {
  const r = S.scoreQuestion(G.questions.q3, { option: "a", etc: "" });
  assert.equal(r.auto, 1);
});

test("함정형: 기타에 OCR과 사람 확인을 쓰면 3점", opt, () => {
  const r = S.scoreQuestion(G.questions.q3, { option: "a", etc: "OCR로 읽고 간호사가 원본과 대조해서 확인" });
  assert.equal(r.auto, 3);
  assert.ok(r.hits.includes("ocr"));
});

test("함정형: OCR만 쓰면 2점", opt, () => {
  assert.equal(S.scoreQuestion(G.questions.q3, { etc: "OCR 돌림" }).auto, 2);
});

test("합치기형: 두 선택지 내용을 합쳐야 3점", opt, () => {
  assert.equal(S.scoreQuestion(G.questions.q4, { option: "a" }).auto, 2);
  assert.equal(S.scoreQuestion(G.questions.q4, { option: "a", etc: "검진 시즌 전 4주차 일부 운영, 나머지는 6주까지 순차" }).auto, 3);
});

test("띄어쓰기가 달라도 핵심어를 찾는다", opt, () => {
  assert.equal(S.scoreQuestion(G.questions.q5, { etc: "식별 정보 제거 후 회사 API 사용" }).auto, 3);
});

test("결함 찾기: 멀쩡한 항목을 고르면 감점", opt, () => {
  const all = ["p1", "p2", "p3", "p4", "p5", "p6", "p9"];
  assert.equal(S.scoreQuestion(G.questions.q7, { options: all }).auto, 3);
  assert.equal(S.scoreQuestion(G.questions.q7, { options: [...all, "p7", "p8"] }).auto, 2);
});

test("정보 카드: 반전 카드 수가 점수, 최대 3", opt, () => {
  assert.equal(S.scoreQuestion(G.questions.q1, { cards: ["c1", "c3", "c5"] }).auto, 3);
  assert.equal(S.scoreQuestion(G.questions.q1, { cards: ["c4", "c8", "c2"] }).auto, 0);
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

test("고른 선택지에 맞는 추가질문이 나온다", opt, () => {
  const ans = { q3: { option: "a" } };
  const sc = S.scoreAll(G, ans, {});
  const ids = S.selectFollowups(G, sc, ans, 10).map((x) => x.id);
  assert.ok(ids.includes("f3"));
  assert.ok(!ids.includes("f4"));
});

test("기타로 만점을 받으면 선택지 기반 추가질문은 나오지 않는다", opt, () => {
  const ans = { q4: { option: "a", etc: "4주차 일부 운영, 나머지는 6주까지 순차" } };
  const ids = S.selectFollowups(G, S.scoreAll(G, ans, {}), ans, 10).map((x) => x.id);
  assert.ok(!ids.includes("f8"));
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
  const ans = { q3: { option: "a" }, q6: { option: "b" } };
  const base = S.scoreAll(G, { q3: { option: "a" } }, {});
  const sc = S.scoreAll(G, ans, {});
  const k = sc.combos.find((c) => c.id === "k1");
  assert.ok(k && k.applied);
  assert.ok(k.ripple.length > 0);
  assert.equal(sc.raw - sc.penalty, sc.total);
  assert.equal(sc.raw, base.raw + 1);
  assert.equal(sc.penalty, k.penalty);
});

test("한쪽만 틀리면 조합 감점은 없다", opt, () => {
  const sc = S.scoreAll(G, { q3: { option: "a" }, q6: { option: "a" } }, {});
  assert.ok(!sc.combos.some((c) => c.id === "k1"));
});

test("결함 찾기에서 고친 항목은 조합 조건에서 빠진다", opt, () => {
  const bad = S.scoreAll(G, { q8: { option: "c" } }, {});
  const fixed = S.scoreAll(G, { q8: { option: "c" }, q7: { options: ["p5"] } }, {});
  assert.ok(bad.combos.some((c) => c.id === "k4"));
  assert.ok(!fixed.combos.some((c) => c.id === "k4"));
});

test("면접관이 조합 감점을 끄면 총점에서 빠진다", opt, () => {
  const ans = { q3: { option: "a" }, q6: { option: "b" } };
  const on = S.scoreAll(G, ans, {});
  const off = S.scoreAll(G, ans, {}, { k1: true });
  assert.equal(off.total - on.total, on.combos.find((c) => c.id === "k1").penalty);
});

test("조합 감점은 상한이 있고 총점은 0 아래로 내려가지 않는다", opt, () => {
  const ans = {
    q2: { option: "b" }, q3: { option: "a" }, q4: { option: "c" }, q5: { option: "b" },
    q6: { option: "b" }, q8: { option: "c" }, q9: { option: "a" }, q11: { option: "b" }
  };
  const sc = S.scoreAll(G, ans, {});
  assert.ok(sc.penalty <= G.comboCap);
  assert.ok(sc.total >= 0);
});

test("위험 조합이 있으면 점수가 높아도 추천하지 않는다", opt, () => {
  const ans = fullMarks();
  ans.q5 = { option: "b" };
  ans.q6 = { option: "c" };
  const sc = S.scoreAll(G, ans, { q5: 3, q6: 3 });
  assert.ok(sc.combos.some((c) => c.id === "k3" && c.critical));
  assert.notEqual(sc.verdict, "면접 추천");
});

test("조합 추가질문이 먼저 나온다", opt, () => {
  const ans = { q3: { option: "a" }, q6: { option: "b" } };
  const f = S.selectFollowups(G, S.scoreAll(G, ans, {}), ans, 4);
  assert.equal(f[0].id, "k1");
});

function fullMarks() {
  return {
    q1: { cards: ["c1", "c3", "c5"] }, q2: { option: "c" },
    q3: { etc: "OCR 후 간호사가 원본과 대조" }, q4: { etc: "4주차 일부 운영 후 나머지 순차" },
    q5: { etc: "식별정보 가리고 계약된 API" }, q6: { etc: "업체별 매핑, 동명이인은 간호사 확인" },
    q7: { options: ["p1", "p2", "p3", "p4", "p5", "p6", "p9"] }, q8: { etc: "업체 판정 그대로, 어긋나면 표시" },
    q9: { etc: "원본 페이지 연결과 상태 이력" }, q10: { option: "a" }, q11: { etc: "실제로 사용하는지와 오류 0건" }
  };
}

test("만점 답안은 면접 추천", opt, () => {
  const ans = {
    q1: { cards: ["c1", "c3", "c5"] }, q2: { option: "c" },
    q3: { etc: "OCR 후 간호사가 원본과 대조" }, q4: { etc: "4주차 일부 운영 후 나머지 순차" },
    q5: { etc: "식별정보 가리고 계약된 API" }, q6: { etc: "업체별 매핑, 동명이인은 간호사 확인" },
    q7: { options: ["p1", "p2", "p3", "p4", "p5", "p6", "p9"] }, q8: { etc: "업체 판정 그대로, 어긋나면 표시" },
    q9: { etc: "원본 페이지 연결과 상태 이력" }, q10: { option: "a" }, q11: { etc: "실제로 사용하는지와 오류 0건" }
  };
  const sc = S.scoreAll(G, ans, {});
  assert.equal(sc.total, 33);
  assert.equal(sc.verdict, "면접 추천");
});

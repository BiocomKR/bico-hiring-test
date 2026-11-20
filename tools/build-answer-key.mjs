// 채점 원본을 암호화하고 정보 카드 문구를 인코딩한다. 원본은 저장소 밖에 둔다.
// 실행: GRADING_PASSWORD=... node tools/build-answer-key.mjs <채점 원본 폴더>
import { readFile, writeFile } from "node:fs/promises";
import { webcrypto as crypto } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ITER = 310000; // OWASP 2023 권장 PBKDF2-SHA256 반복 수
const dir = process.argv[2];
const pw = process.env.GRADING_PASSWORD;
if (!dir || !pw) {
  throw new Error("사용법: GRADING_PASSWORD=... node tools/build-answer-key.mjs <채점 원본 폴더>");
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const b64 = (buf) => Buffer.from(buf).toString("base64");

const grading = await readFile(path.join(dir, "grading.json"), "utf8");
JSON.parse(grading);
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
const key = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" },
  base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
);
const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(grading));
await writeFile(path.join(root, "grading.enc.json"),
  JSON.stringify({ v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(data) }) + "\n");

const cards = JSON.parse(await readFile(path.join(dir, "cards.json"), "utf8"));
// 카드는 장별로 암호화한다. app.js 의 CARD_PASS 와 같아야 하며, 비밀이 아니라 개발자 도구에서 바로 읽히지 않게 하는 정도다
const CARD_PASS = "bico-hiring-card-v1";
const enc = {};
for (const [id, text] of Object.entries(cards)) {
  const cs = crypto.getRandomValues(new Uint8Array(16));
  const ci = crypto.getRandomValues(new Uint8Array(12));
  const cm = await crypto.subtle.importKey("raw", new TextEncoder().encode(CARD_PASS + ":" + id), "PBKDF2", false, ["deriveKey"]);
  const ck = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: cs, iterations: 100000, hash: "SHA-256" },
    cm, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const cd = await crypto.subtle.encrypt({ name: "AES-GCM", iv: ci }, ck, new TextEncoder().encode(text));
  enc[id] = { s: b64(cs), i: b64(ci), d: b64(cd) };
}
await writeFile(path.join(root, "cards.js"), "window.CARDS = " + JSON.stringify(enc) + ";\n");
console.log("grading.enc.json, cards.js 생성");

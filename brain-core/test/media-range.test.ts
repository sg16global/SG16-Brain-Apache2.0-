// Byte ranges for the robot video: Safari needs 206 answers to play it.
import test from "node:test";
import assert from "node:assert/strict";
import { withByteRange } from "../src/media-range.ts";

const bytes = new Uint8Array(1000).map((_, i) => i % 256);
const video = () => new Response(bytes, { status: 200, headers: { "content-type": "video/mp4", "content-length": "1000" } });
const get = (range?: string) => new Request("https://x/images/sg16-robo.mp4", { headers: range ? { range } : {} });

test("a byte range of a video is answered with 206 and exactly that slice", async () => {
  const res = await withByteRange(get("bytes=0-1"), video());
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 0-1/1000");
  assert.equal(res.headers.get("content-length"), "2");
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [0, 1]);

  const open = await withByteRange(get("bytes=990-"), video());
  assert.equal(open.headers.get("content-range"), "bytes 990-999/1000");
  assert.equal((await open.arrayBuffer()).byteLength, 10);

  const tail = await withByteRange(get("bytes=-5"), video());
  assert.equal(tail.headers.get("content-range"), "bytes 995-999/1000");

  const past = await withByteRange(get("bytes=0-5000"), video());
  assert.equal(past.headers.get("content-range"), "bytes 0-999/1000");
});

test("a range outside the file is 416; no range keeps 200 and says ranges work", async () => {
  const bad = await withByteRange(get("bytes=2000-3000"), video());
  assert.equal(bad.status, 416);
  assert.equal(bad.headers.get("content-range"), "bytes */1000");
  const whole = await withByteRange(get(), video());
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get("accept-ranges"), "bytes");
  assert.equal((await whole.arrayBuffer()).byteLength, 1000);
});

test("pages, and answers that already are 206, pass through untouched", async () => {
  const page = new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
  assert.equal(await withByteRange(get("bytes=0-1"), page), page);
  const partial = new Response("ab", { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-1/1000" } });
  assert.equal(await withByteRange(get("bytes=0-1"), partial), partial);
});

#!/usr/bin/env node
// Extract each mirrored page's inline flight payload (the self.__next_f.push
// stream) into site/rsc/<route>.txt. Those files are what the Worker serves
// for Next.js client-side navigation RSC requests (content-type text/x-component).
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const site = process.argv[2];
if (!site || !existsSync(join(site, "index.html"))) {
  console.error("usage: node extract-rsc.mjs <site-dir>");
  process.exit(1);
}

function extract(htmlPath) {
  const s = readFileSync(htmlPath, "utf8");
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m; const parts = [];
  while ((m = re.exec(s)) !== null) parts.push(JSON.parse(m[1]));
  return parts.join("");
}

const outDir = join(site, "rsc");
mkdirSync(outDir, { recursive: true });

const routes = readdirSync(site)
  .filter((d) => existsSync(join(site, d, "index.html")))
  .filter((d) => d !== "panel"); // /panel is the separate chat app, not part of the Next export

let n = 0;
const rootPayload = extract(join(site, "index.html"));
writeFileSync(join(outDir, "index.txt"), rootPayload);
console.log(`rsc/index.txt  ${rootPayload.length}`);
n++;
for (const route of routes) {
  const payload = extract(join(site, route, "index.html"));
  if (!payload) { console.error("no flight data in " + route); process.exitCode = 1; continue; }
  writeFileSync(join(outDir, route + ".txt"), payload);
  console.log(`rsc/${route}.txt  ${payload.length}`);
  n++;
}
console.log(`wrote ${n} payload files`);

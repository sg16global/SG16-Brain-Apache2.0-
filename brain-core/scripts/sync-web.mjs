#!/usr/bin/env node
// Stage the public front-end into brain-core/client/ for Workers assets.
//
//   site/          the sovereign design (mirrored from the pointoni app +
//                  its public assets) — committed, so deploys are
//                  reproducible and CI can never wipe the design.
//
// The old pass-gated chat panel (../web, once served at /panel/) is no longer
// staged: nothing linked to it, and the owner asked for it removed (2026-10-18).
//
// Layout after staging:  client/          -> https://<the site>/
// All /api/* and /v1/* requests are handled by the Worker (run_worker_first),
// never by these assets.

import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const brainCore = join(here, "..");
const site = join(brainCore, "site");
const client = join(brainCore, "client");

if (!existsSync(join(site, "index.html"))) {
  console.error("site/index.html not found — the design mirror is missing: " + site);
  process.exit(1);
}

rmSync(client, { recursive: true, force: true });
mkdirSync(client, { recursive: true });

// the design front-end
cpSync(site, client, { recursive: true });

console.log("staged: design front-end -> " + client);

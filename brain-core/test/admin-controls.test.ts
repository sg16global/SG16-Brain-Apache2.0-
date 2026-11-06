// The operator's switches on /admin (owner request 2026-11-06):
//   * every API key: ON / OFF / BROKEN (BROKEN is final, for unused keys)
//   * BRAIN POWER: on = the brain answers, off = it answers nobody
// Both are operator-only; a visitor account (email code) can never use them.

import test from "node:test";
import assert from "node:assert/strict";

import {
  designCompatRoute,
  createProjectKey,
  projectKeyRecord,
  verifyProjectKey,
  signIdentityToken,
  signAccountToken,
  type DesignEnv,
} from "../src/design-compat.ts";
import { authenticate } from "../src/auth.ts";

const IDENTITY_SECRET = "admin-controls-identity-secret-0123456789";
const PROJECT_SECRET = "admin-controls-project-secret-0123456789";

function kvStub() {
  const map = new Map<string, string>();
  return {
    map,
    get: async (key: string) => map.get(key) ?? null,
    put: async (key: string, value: string) => void map.set(key, value),
    delete: async (key: string) => void map.delete(key),
    list: async (options?: { prefix?: string }) => ({
      keys: [...map.keys()].filter((k) => !options?.prefix || k.startsWith(options.prefix)).map((name) => ({ name })),
      list_complete: true,
      cursor: "",
    }),
  };
}

// a request log with no rows: the activity box only needs the key records
const emptyLog = {
  prepare: () => {
    const stmt = { bind: () => stmt, all: async () => ({ results: [] }), first: async () => null };
    return stmt;
  },
};

function setup() {
  const kv = kvStub();
  const power = { on: true };
  const e = {
    KEYS: kv as never,
    LOGS: emptyLog as never,
    QUEUE: {} as never,
    MATRIX: {} as never,
    SG16_IDENTITY_SECRET: IDENTITY_SECRET,
    SG16_ADMIN_PASSWORD: "operator-password-123",
    SG16_PROJECT_KEY_SECRET: PROJECT_SECRET,
  } as DesignEnv;
  const deps = {
    env: e,
    chatDoor: async () => Response.json({ ok: true, answer: "hi", meta: {} }),
    healthProbe: async () => ({ d1: true, model: true, power: power.on }),
    keyAuth: async () => null,
    brainPower: {
      get: async () => power.on,
      set: async (on: boolean) => { power.on = on; return power.on; },
    },
  };
  return { e, kv, power, deps };
}

async function operator() {
  return await signIdentityToken("sg16global@gmail.com", IDENTITY_SECRET);
}

async function send(deps: ReturnType<typeof setup>["deps"], path: string, token: string | null, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await designCompatRoute(
    new Request("https://x" + path, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    path,
    deps,
  );
  return { status: res!.status, body: (await res!.json()) as Record<string, unknown> };
}

// ---- API keys: ON / OFF / BROKEN ---------------------------------------------------

test("API key switch: OFF pauses a key, ON brings it back, BROKEN retires it for good", async () => {
  const { e, kv, deps } = setup();
  const op = await operator();
  const key = await createProjectKey("shop", PROJECT_SECRET);
  const project = await verifyProjectKey(key, PROJECT_SECRET, []);
  const id = projectKeyRecord(key, "shop", project!.issuedAt).id;
  const auth = () => authenticate(`Bearer ${key}`, kv as never, PROJECT_SECRET, []);

  assert.equal((await auth()).ok, true, "a new key is ON");

  const off = await send(deps, "/api/admin/project-control", op, { id, state: "off" });
  assert.deepEqual(off.body, { ok: true, id, control: "off" });
  assert.deepEqual(await auth(), { ok: false, off: true }, "OFF: the key is paused");

  const on = await send(deps, "/api/admin/project-control", op, { id, state: "on" });
  assert.equal(on.body.control, "on");
  assert.equal((await auth()).ok, true, "ON again: the key works");

  const broken = await send(deps, "/api/admin/project-control", op, { id, state: "broken" });
  assert.equal(broken.body.control, "broken");
  assert.deepEqual(await auth(), { ok: false }, "BROKEN: a dead key");
  const revive = await send(deps, "/api/admin/project-control", op, { id, state: "on" });
  assert.equal(revive.status, 409, "BROKEN is final");
  assert.deepEqual(await auth(), { ok: false });
  void e;
});

test("API key switch works for old keys too, and the activity box shows each key's switch", async () => {
  const { kv, deps } = setup();
  const op = await operator();
  // an old key: minted before key records existed (no projkey: record), seen only in the log
  const old = await createProjectKey("legacy", PROJECT_SECRET);
  const id = projectKeyRecord(old, "legacy", 0).id;
  assert.equal((await send(deps, "/api/admin/project-control", op, { id, state: "off" })).status, 200);
  assert.deepEqual(await authenticate(`Bearer ${old}`, kv as never, PROJECT_SECRET, []), { ok: false, off: true });

  // a recorded key (minted through the console), then switched OFF
  const minted = await send(deps, "/api/admin/project-keys", op, { project: "shop" });
  const shopKey = minted.body.key as string;
  const shopId = projectKeyRecord(shopKey, "shop", 0).id;
  await send(deps, "/api/admin/project-control", op, { id: shopId, state: "off" });
  const activity = await send(deps, "/api/admin/project-activity", op);
  const shop = (activity.body.projects as Array<Record<string, unknown>>).find((p) => p.project === "shop")!;
  assert.equal(shop.id, shopId);
  assert.equal(shop.control, "off");
  assert.equal(shop.status, "off");

  // BROKEN also marks its minted record revoked
  await send(deps, "/api/admin/project-control", op, { id: shopId, state: "broken" });
  const after = await send(deps, "/api/admin/project-activity", op);
  const gone = (after.body.projects as Array<Record<string, unknown>>).find((p) => p.project === "shop")!;
  assert.equal(gone.status, "broken");
  const records = await send(deps, "/api/admin/project-keys", op);
  assert.equal((records.body.keys as Array<{ revoked: boolean }>)[0].revoked, true);
});

test("API key switch: operator only, and bad input is refused", async () => {
  const { deps } = setup();
  const visitor = await signAccountToken("sg16global@gmail.com", IDENTITY_SECRET);
  const id = "sg16p_shop_aaaaaaaaaaaa";
  assert.equal((await send(deps, "/api/admin/project-control", null, { id, state: "off" })).status, 401);
  assert.equal((await send(deps, "/api/admin/project-control", visitor, { id, state: "off" })).status, 403,
    "an email-code account, even for the operator's email, is not the operator");
  const op = await operator();
  assert.equal((await send(deps, "/api/admin/project-control", op, { id: "projkey:../x", state: "off" })).status, 400);
  assert.equal((await send(deps, "/api/admin/project-control", op, { id, state: "maybe" })).status, 400);
});

test("a key that does not work gets a key error on the chat endpoint, not the visitor's sign-in note", async () => {
  const { deps } = setup();
  for (const bad of ["sg16_" + "x".repeat(40), "sg16p_eyJ2IjoxfQ.forged"]) {
    const res = await designCompatRoute(
      new Request("https://x/api/brain", { method: "POST", headers: { authorization: `Bearer ${bad}`, "content-type": "application/json" }, body: JSON.stringify({ message: "hi" }) }),
      "/api/brain",
      deps,
    );
    assert.equal(res!.status, 403, bad.slice(0, 6));
    assert.equal(((await res!.json()) as { keyOff: boolean }).keyOff, true);
  }
});

// ---- BRAIN POWER ---------------------------------------------------------------------

test("BRAIN POWER: the operator reads and flips it; visitors cannot", async () => {
  const { power, deps } = setup();
  const op = await operator();
  assert.deepEqual((await send(deps, "/api/admin/brain-power", op)).body, { on: true });

  const offRes = await send(deps, "/api/admin/brain-power", op, { on: false });
  assert.deepEqual(offRes.body, { ok: true, on: false });
  assert.equal(power.on, false);
  // the public health probe says so
  const probe = await designCompatRoute(new Request("https://x/api/brain?probe=health"), "/api/brain", deps);
  assert.equal(probe!.status, 503);
  assert.equal(((await probe!.json()) as { brain: string }).brain, "off");

  assert.deepEqual((await send(deps, "/api/admin/brain-power", op, { on: true })).body, { ok: true, on: true });
  assert.equal((await send(deps, "/api/admin/brain-power", op, { on: "yes" })).status, 400);

  const visitor = await signAccountToken("someone@example.com", IDENTITY_SECRET);
  assert.equal((await send(deps, "/api/admin/brain-power", visitor, { on: false })).status, 403);
  assert.equal((await send(deps, "/api/admin/brain-power", null, { on: false })).status, 401);
  assert.equal(power.on, true, "nobody but the operator flips it");
});

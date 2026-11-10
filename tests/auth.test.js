import { test, describe } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import {
  hashPassword, verifyPassword, createSessionToken, readSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS,
} from "../src/services/auth.js";
import { FakeR2 } from "./helpers/fake-r2.js";

const ORIGIN = "https://journal.test";
const PASSWORD = "correct horse battery";

async function makeEnv(overrides = {}) {
  return {
    ENVIRONMENT: "test",
    ADMIN_USERNAME: "dovene",
    ADMIN_OWNER_ID: "dovene",
    ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD, 10_000), // fewer iterations keep tests fast
    SESSION_SECRET: "s".repeat(48),
    STORAGE: new FakeR2(),
    ASSETS: { fetch: async (req) => new Response(`asset:${new URL(req.url).pathname}`) },
    ...overrides,
  };
}

const fetchApp = (env, path, init = {}) => worker.fetch(new Request(ORIGIN + path, init), env, {});
const login = (env, body, headers = {}) =>
  fetchApp(env, "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers }, body: JSON.stringify(body) });
const cookieFrom = (res) => (res.headers.get("set-cookie") || "").split(";")[0];

describe("passwords", () => {
  test("hash round-trip, salted, and wrong passwords fail", async () => {
    const a = await hashPassword(PASSWORD, 10_000);
    const b = await hashPassword(PASSWORD, 10_000);
    assert.match(a, /^pbkdf2-sha256\$10000\$[\w-]+\$[\w-]+$/);
    assert.notEqual(a, b, "a random salt makes every hash different");
    assert.equal(await verifyPassword(PASSWORD, a), true);
    assert.equal(await verifyPassword(PASSWORD + "x", a), false);
  });

  test("malformed or weak stored hashes are rejected", async () => {
    for (const bad of ["", "plain", "md5$1$a$b", "pbkdf2-sha256$10$AAAA$AAAA", "pbkdf2-sha256$999999$AAAA$AAAA"])
      assert.equal(await verifyPassword(PASSWORD, bad), false, bad);
  });
});

describe("session tokens", () => {
  test("valid, tampered, wrong key, expired, foreign owner", async () => {
    const env = await makeEnv();
    const now = Date.now();
    const token = await createSessionToken(env, { ownerId: "dovene", username: "dovene" }, now);
    assert.equal((await readSessionToken(env, token, now)).ownerId, "dovene");

    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "dovene", usr: "dovene", iat: 0, exp: 9e9 })).toString("base64url");
    assert.equal(await readSessionToken(env, `${forged}.${sig}`, now), null, "payload cannot be changed");
    assert.equal(await readSessionToken({ ...env, SESSION_SECRET: "t".repeat(48) }, token, now), null, "other key");
    assert.equal(await readSessionToken(env, token, now + (SESSION_TTL_SECONDS + 1) * 1000), null, "expired");
    assert.equal(await readSessionToken({ ...env, ADMIN_OWNER_ID: "sarah" }, token, now), null, "account changed");
    assert.equal(await readSessionToken(env, `${body}.${sig}.x`, now), null);
    assert.equal(await readSessionToken(env, "garbage", now), null);
  });
});

describe("login, session and logout", () => {
  test("successful login sets a secure session cookie that unlocks the admin API", async () => {
    const env = await makeEnv();
    const res = await login(env, { username: "Dovene", password: PASSWORD });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get("set-cookie");
    for (const attr of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", `Max-Age=${SESSION_TTL_SECONDS}`]) assert.ok(setCookie.includes(attr), attr);
    assert.ok(setCookie.startsWith(`${SESSION_COOKIE}=`));
    assert.doesNotMatch(await res.text(), /pbkdf2|correct horse/, "no secrets in the response");

    const cookie = cookieFrom(res);
    const session = await (await fetchApp(env, "/api/admin/session", { headers: { Cookie: cookie } })).json();
    assert.deepEqual(session, { authenticated: true, ownerId: "dovene", username: "dovene" });
    assert.equal((await fetchApp(env, "/api/admin/places", { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetchApp(env, "/api/admin/places")).status, 401);
  });

  test("wrong password and unknown user get the same answer", async () => {
    const env = await makeEnv();
    const a = await login(env, { username: "dovene", password: "nope" });
    const b = await login(env, { username: "mallory", password: PASSWORD });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.deepEqual(await a.json(), await b.json());
    assert.equal(a.headers.get("set-cookie"), null);
  });

  test("login is rate limited per IP", async () => {
    const calls = [];
    const env = await makeEnv({ LOGIN_LIMITER: { limit: async ({ key }) => (calls.push(key), { success: calls.length <= 5 }) } });
    for (let i = 0; i < 5; i++) assert.equal((await login(env, { username: "dovene", password: "x" }, { "CF-Connecting-IP": "203.0.113.9" })).status, 401);
    const blocked = await login(env, { username: "dovene", password: PASSWORD }, { "CF-Connecting-IP": "203.0.113.9" });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "60");
    assert.equal(calls[0], "login:203.0.113.9");
  });

  test("login refuses cross-site posts and unconfigured environments", async () => {
    assert.equal((await login(await makeEnv(), { username: "dovene", password: PASSWORD }, { Origin: "https://evil.test" })).status, 403);
    assert.equal((await login(await makeEnv({ ADMIN_PASSWORD_HASH: undefined }), { username: "dovene", password: PASSWORD })).status, 503);
    assert.equal((await login(await makeEnv({ SESSION_SECRET: "short" }), { username: "dovene", password: PASSWORD })).status, 503);
  });

  test("logout clears the cookie", async () => {
    const env = await makeEnv();
    const res = await fetchApp(env, "/api/admin/logout", { method: "POST", headers: { Origin: ORIGIN } });
    assert.equal(res.status, 204);
    assert.match(res.headers.get("set-cookie"), /Max-Age=0/);
  });
});

describe("admin pages", () => {
  test("signed-out visitors are redirected to the login page", async () => {
    const env = await makeEnv();
    for (const path of ["/admin", "/admin/", "/admin/index.html"]) {
      const res = await fetchApp(env, path);
      assert.equal(res.status, 302, path);
      assert.equal(res.headers.get("location"), `${ORIGIN}/admin/login`);
    }
    const loginPage = await fetchApp(env, "/admin/login");
    assert.equal(await loginPage.text(), "asset:/admin/login");
    assert.equal(loginPage.headers.get("cache-control"), "no-store");
  });

  test("signed-in visitors get the editor, and the login page sends them to it", async () => {
    const env = await makeEnv();
    const cookie = cookieFrom(await login(env, { username: "dovene", password: PASSWORD }));
    assert.equal(await (await fetchApp(env, "/admin/", { headers: { Cookie: cookie } })).text(), "asset:/admin/");
    const res = await fetchApp(env, "/admin/login", { headers: { Cookie: cookie } });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), `${ORIGIN}/admin/`);
  });

  test("public pages are untouched", async () => {
    assert.equal(await (await fetchApp(await makeEnv(), "/place?slug=rome")).text(), "asset:/place");
  });
});

import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, test } from "node:test";

import worker from "../src/index.js";

const APPLICATION_ID = "123456789012345678";
const GUILD_ID = "234567890123456789";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
const PUBLIC_KEY_HEX = publicKeyDer.subarray(publicKeyDer.length - 32).toString("hex");

const env = {
  DISCORD_PUBLIC_KEY: PUBLIC_KEY_HEX,
  DISCORD_APPLICATION_ID: APPLICATION_ID,
  DISCORD_GUILD_ID: GUILD_ID,
};

function signedRequest(
  body: string,
  options: { timestamp?: string; signedBody?: string; headers?: HeadersInit } = {},
): Request {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1_000).toString();
  const signedBody = options.signedBody ?? body;
  const signature = sign(null, Buffer.from(timestamp + signedBody), privateKey).toString("hex");
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  headers.set("x-signature-ed25519", signature);
  headers.set("x-signature-timestamp", timestamp);
  return new Request("https://dice.example/interactions", { method: "POST", headers, body });
}

function command(notation: unknown = "2d20+3"): string {
  return JSON.stringify({
    type: 2,
    application_id: APPLICATION_ID,
    guild_id: GUILD_ID,
    data: {
      name: "roll",
      type: 1,
      options: [{ name: "notation", type: 3, value: notation }],
    },
  });
}

describe("Worker routes", () => {
  test("returns a small configuration-free health response", async () => {
    const response = await worker.fetch(new Request("https://dice.example/"), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });

  test("returns 404 for unknown routes", async () => {
    const response = await worker.fetch(new Request("https://dice.example/missing"), env);
    assert.equal(response.status, 404);
  });

  test("returns 405 for a known route with the wrong method", async () => {
    const response = await worker.fetch(new Request("https://dice.example/interactions"), env);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
  });
});

describe("Discord authentication", () => {
  test("verifies a signed PING and returns PONG", async () => {
    const response = await worker.fetch(signedRequest(JSON.stringify({ type: 1 })), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { type: 1 });
  });

  test("allows PING without a guild but enforces application_id when supplied", async () => {
    const good = await worker.fetch(
      signedRequest(JSON.stringify({ type: 1, application_id: APPLICATION_ID })),
      env,
    );
    assert.equal(good.status, 200);

    const bad = await worker.fetch(
      signedRequest(JSON.stringify({ type: 1, application_id: "999999999999999999" })),
      env,
    );
    assert.equal(bad.status, 403);
  });

  test("rejects a missing signature", async () => {
    const response = await worker.fetch(
      new Request("https://dice.example/interactions", {
        method: "POST",
        body: JSON.stringify({ type: 1 }),
      }),
      env,
    );
    assert.equal(response.status, 401);
  });

  test("rejects malformed signature headers", async () => {
    const request = signedRequest(JSON.stringify({ type: 1 }), {
      headers: { "x-signature-ed25519": "not-hex" },
    });
    request.headers.set("x-signature-ed25519", "not-hex");
    const response = await worker.fetch(request, env);
    assert.equal(response.status, 401);
  });

  test("rejects a body changed after signing", async () => {
    const response = await worker.fetch(
      signedRequest(JSON.stringify({ type: 2 }), {
        signedBody: JSON.stringify({ type: 1 }),
      }),
      env,
    );
    assert.equal(response.status, 401);
  });

  test("rejects stale and overly future timestamps", async () => {
    const stale = Math.floor(Date.now() / 1_000 - 301).toString();
    const future = Math.floor(Date.now() / 1_000 + 31).toString();
    assert.equal(
      (await worker.fetch(signedRequest(JSON.stringify({ type: 1 }), { timestamp: stale }), env))
        .status,
      401,
    );
    assert.equal(
      (await worker.fetch(signedRequest(JSON.stringify({ type: 1 }), { timestamp: future }), env))
        .status,
      401,
    );
  });

  test("fails closed when a required binding is absent or has the wrong runtime type", async () => {
    const body = JSON.stringify({ type: 1 });
    const missing = { ...env };
    Reflect.deleteProperty(missing, "DISCORD_PUBLIC_KEY");
    const mistyped = { ...env };
    Reflect.set(mistyped, "DISCORD_PUBLIC_KEY", 42);
    assert.equal((await worker.fetch(signedRequest(body), missing)).status, 500);
    assert.equal((await worker.fetch(signedRequest(body), mistyped)).status, 500);
  });

  test("fails closed when a required binding is malformed", async () => {
    const body = JSON.stringify({ type: 1 });
    const malformed = { ...env, DISCORD_APPLICATION_ID: "application" };
    assert.equal((await worker.fetch(signedRequest(body), malformed)).status, 500);
  });
});

describe("Discord interactions", () => {
  test("returns a public roll response with mentions disabled", async () => {
    const response = await worker.fetch(signedRequest(command()), env);
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      type: number;
      data: { content: string; allowed_mentions: { parse: string[] }; flags?: number };
    };
    assert.equal(payload.type, 4);
    assert.match(payload.data.content, /^2d20\+3: \[\d+, \d+\] = \d+$/);
    assert.deepEqual(payload.data.allowed_mentions, { parse: [] });
    assert.equal(payload.data.flags, undefined);
    assert.ok(payload.data.content.length < 2_000);
  });

  test("returns a private error for bad notation", async () => {
    const response = await worker.fetch(signedRequest(command("2d6 + 1")), env);
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { type: number; data: { flags: number } };
    assert.equal(payload.type, 4);
    assert.equal(payload.data.flags, 64);
  });

  test("returns a private error for an unsupported command", async () => {
    const body = JSON.stringify({
      type: 2,
      application_id: APPLICATION_ID,
      guild_id: GUILD_ID,
      data: { name: "other", type: 1, options: [] },
    });
    const response = await worker.fetch(signedRequest(body), env);
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { data: { flags: number } };
    assert.equal(payload.data.flags, 64);
  });

  test("requires exactly one correctly typed notation option", async () => {
    const bodies = [
      command(42),
      JSON.stringify({
        type: 2,
        application_id: APPLICATION_ID,
        guild_id: GUILD_ID,
        data: { name: "roll", type: 1, options: [] },
      }),
      JSON.stringify({
        type: 2,
        application_id: APPLICATION_ID,
        guild_id: GUILD_ID,
        data: {
          name: "roll",
          type: 1,
          options: [
            { name: "notation", type: 3, value: "d6" },
            { name: "extra", type: 3, value: "d8" },
          ],
        },
      }),
    ];
    for (const body of bodies) {
      const response = await worker.fetch(signedRequest(body), env);
      const payload = (await response.json()) as { data: { flags: number } };
      assert.equal(payload.data.flags, 64);
    }
  });

  test("rejects the wrong application or guild", async () => {
    const wrongApp = command().replace(APPLICATION_ID, "999999999999999999");
    const wrongGuild = command().replace(GUILD_ID, "999999999999999999");
    assert.equal((await worker.fetch(signedRequest(wrongApp), env)).status, 403);
    assert.equal((await worker.fetch(signedRequest(wrongGuild), env)).status, 403);
  });

  test("rejects signed malformed JSON", async () => {
    const response = await worker.fetch(signedRequest("{"), env);
    assert.equal(response.status, 400);
  });

  test("rejects request bodies above 64 KiB", async () => {
    const response = await worker.fetch(signedRequest("x".repeat(65_537)), env);
    assert.equal(response.status, 413);
  });
});

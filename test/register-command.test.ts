import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  COMMAND_DEFINITION,
  registerGuildCommand,
} from "../scripts/register-command.mjs";

describe("guild command registration", () => {
  test("exports exactly one required string option for roll", () => {
    assert.deepEqual(COMMAND_DEFINITION, {
      name: "roll",
      description: "Roll dice using notation such as d6, 2d20+3, or 3d6-2",
      type: 1,
      options: [
        {
          name: "notation",
          description: "Dice notation, for example 2d20+3",
          type: 3,
          required: true,
        },
      ],
    });
  });

  test("upserts only the roll command through Discord REST v10", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchStub = async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      return new Response(JSON.stringify({ id: "345678901234567890", name: "roll" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await registerGuildCommand(
      {
        DISCORD_BOT_TOKEN: "test-token",
        DISCORD_APPLICATION_ID: "123456789012345678",
        DISCORD_GUILD_ID: "234567890123456789",
      },
      fetchStub,
    );

    assert.deepEqual(result, { id: "345678901234567890", name: "roll" });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0]?.input,
      "https://discord.com/api/v10/applications/123456789012345678/guilds/234567890123456789/commands",
    );
    assert.equal(calls[0]?.init?.method, "POST");
    assert.equal(new Headers(calls[0]?.init?.headers).get("authorization"), "Bot test-token");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), COMMAND_DEFINITION);
  });

  test("validates required environment values before any request", async () => {
    let called = false;
    const fetchStub = async () => {
      called = true;
      return new Response();
    };

    await assert.rejects(
      registerGuildCommand(
        {
          DISCORD_BOT_TOKEN: "",
          DISCORD_APPLICATION_ID: "application",
          DISCORD_GUILD_ID: "guild",
        },
        fetchStub,
      ),
      /environment/i,
    );
    assert.equal(called, false);
  });

  test("reports a sanitized Discord error without exposing the token", async () => {
    const fetchStub = async () =>
      new Response(JSON.stringify({ message: "Invalid Form Body", code: 50035 }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });

    await assert.rejects(
      registerGuildCommand(
        {
          DISCORD_BOT_TOKEN: "secret-token",
          DISCORD_APPLICATION_ID: "123456789012345678",
          DISCORD_GUILD_ID: "234567890123456789",
        },
        fetchStub,
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /400/);
        assert.match(error.message, /Invalid Form Body/);
        assert.doesNotMatch(error.message, /secret-token/);
        return true;
      },
    );
  });
});

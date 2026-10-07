# discord-dice-worker

A `/roll` slash command for Discord that runs on a Cloudflare Worker instead of a bot server.

`/roll d6`, `/roll 2d20+3`, `/roll 3d6-2`

Most Discord bots keep a process online around the clock, holding a Gateway connection open. This one doesn't. Discord sends each command to the Worker as a signed HTTP request, the Worker rolls and answers, and that's it. Nothing to keep alive, nothing to restart, it answers from the edge closest to the user, and it fits comfortably in Cloudflare's free tier.

## How it works

- **Signed requests only.** Every interaction, including Discord's PING, has to carry a valid Ed25519 signature over the timestamp and the raw body. Stale or future timestamps are rejected, and the request body is capped at 64 KiB.
- **Locked to one app and one server.** Commands from any other application or guild are refused.
- **Real randomness.** Rolls use Web Crypto with rejection sampling, so there is no modulo bias.
- **Bounded input.** 1 to 100 dice, 2 to 1000 sides, a modifier up to ±1,000,000, and at most 32 characters of notation. It parses dice notation, it never evaluates expressions.
- **Clean failures.** A bad roll gets a private error that only the sender sees. Mentions are disabled in every reply.
- **No secrets at runtime.** The deployed Worker only needs the public key. The bot token is used once, locally, to register the command.

Checked live in a Discord test server: `/roll 2d20+3` returned `2d20+3: [2, 16] = 21`, and `/roll 101d6` returned a private error.

## Tests

32 tests cover the dice parser, signature checks, and command registration, plus a smoke test against the local Workers runtime. Node.js 22+.

```sh
npm ci
npm test
npm run typecheck
npm run check:types
npm run check:deploy   # bundles with --dry-run, publishes nothing
node scripts/runtime-smoke.mjs
```

Tests sign requests with a generated key, never a real Discord token.

## Set up your own server

1. Create a separate application in the [Discord Developer Portal](https://discord.com/developers/applications). Copy its Application ID and Public Key. The public key is not the bot token.
2. Create or choose the Discord server where the command will run. Copy its server ID, using Discord's Developer Mode if needed.
3. Set `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID` and `DISCORD_GUILD_ID` in `wrangler.jsonc`. Choose a unique Worker name. These three values are identifiers and a public verification key. Never put the bot token in this file.
4. Run `npx wrangler login`, then `npx wrangler whoami`. If you have multiple accounts, set `CLOUDFLARE_ACCOUNT_ID` to the account whose Workers Free plan you verified in the dashboard.
5. Run `npm run types`, repeat the checks above, and deploy with `npx wrangler deploy`.
6. In the application settings, set **Interactions Endpoint URL** to `https://YOUR-WORKER.workers.dev/interactions`. Discord verifies a signed PING before saving it.
7. Install the application into the chosen server with the `applications.commands` scope. A bot installation can also use the `bot` scope with no additional permissions for this command. Administrator and message-content permissions are unnecessary.
8. Register the guild command with the script below, then run `/roll 2d20+3` in that server. Check that invalid notation produces a private error.

This sample accepts commands only from the configured application and server. A command in another server will be rejected. It does not connect to Discord's Gateway, so a bot user's online indicator is not a health check.

### Register the command

The registration script needs the bot token locally. It is not needed by the deployed Worker. In a Bash terminal, enter the token without echoing or saving it in shell history:

```sh
read -r -s -p 'Discord bot token: ' DISCORD_BOT_TOKEN
echo
export DISCORD_BOT_TOKEN
export DISCORD_APPLICATION_ID='YOUR_APPLICATION_ID'
export DISCORD_GUILD_ID='YOUR_SERVER_ID'
node scripts/register-command.mjs
unset DISCORD_BOT_TOKEN
```

The script creates or updates only this application's `/roll` guild command. It does not replace the whole command list. Do not run it against an application where an existing `/roll` command must be preserved.

## Security and operational notes

Every interaction, including PING, must carry a valid Ed25519 signature over the timestamp and the original request bytes. Timestamps older than five minutes or more than 30 seconds in the future are rejected. Application and server IDs are checked for commands. Mentions are disabled in responses.

The handler does not log interaction bodies, user messages, or bot tokens. Sampled platform invocation logs and traces are enabled in `wrangler.jsonc`; review the retention settings before going live. The root health endpoint only confirms that the HTTP handler responds. It does not verify Discord configuration.

Requests are handled immediately, with no outbound calls or deferred jobs. Do not add slow API calls without implementing Discord's response deadlines and appropriate limits. Music, continuous message monitoring and other Gateway features need a separate design.

## References

- [Discord's official Cloudflare Workers tutorial](https://docs.discord.com/developers/tutorials/hosting-on-cloudflare-workers)
- [Discord interactions](https://docs.discord.com/developers/interactions/receiving-and-responding)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

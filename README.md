# Discord dice command on a Worker

A small `/roll notation` command served through Discord's HTTP interactions API. It runs when Discord sends a request, so no computer or continuously running bot process is needed.

Examples: `/roll d6`, `/roll 2d20+3`, `/roll 3d6-2`.

This is an AI-assisted sample. All 32 automated tests and the local Worker runtime smoke test pass. A live deployment was verified in a separate Discord test server on September 17, 2026: `/roll 2d20+3` returned `2d20+3: [2, 16] = 21`. It is not a completed client project.

## Scope

- One application and one allowed Discord server.
- Between 1 and 100 dice, with 2 to 1000 sides per die.
- Optional integer modifier between -1000000 and +1000000.
- At most 32 characters of dice notation, with no arbitrary expression evaluation.
- Public results containing each roll and the total. Invalid dice inputs receive a private error.
- Web Crypto randomness with rejection sampling, signed-request verification, and a 64 KiB request body limit.
- No database, message-content access, game-account linking, moderation system, voice connection, or paid API.

## Hosting limits

Cloudflare Workers Free currently includes 100,000 requests per day per account and 10 ms CPU time per request. Requests to other Workers in the same account share the daily allowance. Usage beyond the free limits can fail. This sample does not promise unlimited hosting, guaranteed availability, or a particular performance level.

Use an account you control and verify that it is on Workers Free before deploying. This project does not need a paid plan or paid storage. A service fee would cover configuration, installation, testing and handoff. The hosting provider is Cloudflare.

Limits checked September 17, 2026: [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## Local checks

Use Node.js 22 or newer.

```sh
npm ci
npm test
npm run typecheck
npm run check:types
npm run check:deploy
node scripts/runtime-smoke.mjs
```

`check:deploy` bundles the Worker with `--dry-run`; it does not publish it. Tests use a generated signing key, not a real Discord token.

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

The handler does not log interaction bodies, user messages, or bot tokens. Sampled platform invocation logs and traces are enabled in `wrangler.jsonc`; review the provider's settings and retention when handing over a client deployment. The root health endpoint only confirms that the HTTP handler responds. It does not verify Discord configuration.

Requests are handled immediately, with no outbound calls or deferred jobs. Do not add slow API calls without implementing Discord's response deadlines and appropriate limits. Music, continuous message monitoring and other Gateway features need a separate design.

## References

- [Discord's official Cloudflare Workers tutorial](https://docs.discord.com/developers/tutorials/hosting-on-cloudflare-workers)
- [Discord interactions](https://docs.discord.com/developers/interactions/receiving-and-responding)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

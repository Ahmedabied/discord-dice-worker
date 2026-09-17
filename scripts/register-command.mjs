import { pathToFileURL } from "node:url";

export const COMMAND_DEFINITION = Object.freeze({
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

const DISCORD_API_BASE = "https://discord.com/api/v10";
const ID_PATTERN = /^[0-9]{17,20}$/;

/**
 * @param {Record<string, string | undefined>} environment
 * @returns {{ token: string, applicationId: string, guildId: string }}
 */
function readEnvironment(environment) {
  const token = environment.DISCORD_BOT_TOKEN;
  const applicationId = environment.DISCORD_APPLICATION_ID;
  const guildId = environment.DISCORD_GUILD_ID;

  if (
    typeof token !== "string" ||
    token.trim() === "" ||
    typeof applicationId !== "string" ||
    !ID_PATTERN.test(applicationId) ||
    typeof guildId !== "string" ||
    !ID_PATTERN.test(guildId)
  ) {
    throw new Error(
      "Invalid environment. Set DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, and DISCORD_GUILD_ID.",
    );
  }

  return { token, applicationId, guildId };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {Record<string, string | undefined>} environment
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<{ id: string, name: string }>}
 */
export async function registerGuildCommand(environment, fetchImpl = fetch) {
  const { token, applicationId, guildId } = readEnvironment(environment);
  const url = `${DISCORD_API_BASE}/applications/${applicationId}/guilds/${guildId}/commands`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      authorization: `Bot ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(COMMAND_DEFINITION),
  });

  /** @type {unknown} */
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const discordMessage =
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message.slice(0, 200).replaceAll(token, "[redacted]")
        : "Discord returned an error";
    const discordCode =
      isRecord(payload) && (typeof payload.code === "number" || typeof payload.code === "string")
        ? `, code ${String(payload.code)}`
        : "";
    throw new Error(`Command registration failed with HTTP ${response.status}${discordCode}: ${discordMessage}`);
  }

  if (!isRecord(payload) || typeof payload.id !== "string" || typeof payload.name !== "string") {
    throw new Error("Discord returned an invalid command registration response.");
  }

  return { id: payload.id, name: payload.name };
}

async function main() {
  const command = await registerGuildCommand(process.env);
  console.log(`Registered /${command.name} command with ID ${command.id}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Command registration failed.";
    console.error(message);
    process.exitCode = 1;
  });
}

import { formatRoll, parseDiceNotation, rollDice } from "./dice.js";

const MAX_BODY_BYTES = 64 * 1_024;
const MAX_SIGNATURE_AGE_SECONDS = 300;
const MAX_FUTURE_SECONDS = 30;
const DISCORD_PING = 1;
const DISCORD_APPLICATION_COMMAND = 2;
const DISCORD_PONG = 1;
const DISCORD_CHANNEL_MESSAGE = 4;
const EPHEMERAL_FLAG = 64;

interface DiscordConfig {
  publicKey: Uint8Array;
  applicationId: string;
  guildId: string;
}

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

function statusResponse(status: number, message: string, headers?: HeadersInit): Response {
  return jsonResponse({ error: message }, status, headers);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeHex(value: string, byteLength: number): Uint8Array | null {
  if (value.length !== byteLength * 2 || !/^[0-9a-f]+$/i.test(value)) {
    return null;
  }

  const bytes = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function readConfig(env: Env): DiscordConfig | null {
  if (
    typeof env.DISCORD_PUBLIC_KEY !== "string" ||
    typeof env.DISCORD_APPLICATION_ID !== "string" ||
    typeof env.DISCORD_GUILD_ID !== "string"
  ) {
    return null;
  }

  const publicKey = decodeHex(env.DISCORD_PUBLIC_KEY, 32);
  const idPattern = /^[0-9]{17,20}$/;
  if (
    publicKey === null ||
    !idPattern.test(env.DISCORD_APPLICATION_ID) ||
    !idPattern.test(env.DISCORD_GUILD_ID)
  ) {
    return null;
  }

  return {
    publicKey,
    applicationId: env.DISCORD_APPLICATION_ID,
    guildId: env.DISCORD_GUILD_ID,
  };
}

async function readBoundedBody(request: Request): Promise<Uint8Array | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && /^[0-9]+$/.test(contentLength)) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > MAX_BODY_BYTES) {
      return null;
    }
  }

  if (request.body === null) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function validTimestamp(value: string | null, nowSeconds: number): value is string {
  if (value === null || !/^[0-9]+$/.test(value)) {
    return false;
  }
  const timestamp = Number(value);
  return (
    Number.isSafeInteger(timestamp) &&
    timestamp >= 0 &&
    nowSeconds - timestamp <= MAX_SIGNATURE_AGE_SECONDS &&
    timestamp - nowSeconds <= MAX_FUTURE_SECONDS
  );
}

async function verifyDiscordSignature(
  request: Request,
  body: Uint8Array,
  publicKeyBytes: Uint8Array,
): Promise<boolean> {
  const signature = decodeHex(request.headers.get("x-signature-ed25519") ?? "", 64);
  const timestamp = request.headers.get("x-signature-timestamp");
  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (signature === null || !validTimestamp(timestamp, nowSeconds)) {
    return false;
  }

  const timestampBytes = new TextEncoder().encode(timestamp);
  const signedMessage = new Uint8Array(timestampBytes.byteLength + body.byteLength);
  signedMessage.set(timestampBytes);
  signedMessage.set(body, timestampBytes.byteLength);

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify({ name: "Ed25519" }, key, signature, signedMessage);
  } catch {
    return false;
  }
}

function interactionResponse(content: string, ephemeral = false): Response {
  return jsonResponse({
    type: DISCORD_CHANNEL_MESSAGE,
    data: {
      content,
      allowed_mentions: { parse: [] },
      ...(ephemeral ? { flags: EPHEMERAL_FLAG } : {}),
    },
  });
}

function privateError(content: string): Response {
  return interactionResponse(content, true);
}

function hasExpectedScope(interaction: Record<string, unknown>, config: DiscordConfig): boolean {
  return (
    interaction.application_id === config.applicationId && interaction.guild_id === config.guildId
  );
}

function handleCommand(interaction: Record<string, unknown>): Response {
  const data = interaction.data;
  if (!isRecord(data) || data.name !== "roll" || data.type !== 1) {
    return privateError("Unsupported command.");
  }

  const options = data.options;
  if (!Array.isArray(options) || options.length !== 1) {
    return privateError("Provide one dice notation value.");
  }

  const option = options[0];
  if (
    !isRecord(option) ||
    option.name !== "notation" ||
    option.type !== 3 ||
    typeof option.value !== "string"
  ) {
    return privateError("Provide one dice notation value.");
  }

  const spec = parseDiceNotation(option.value);
  if (spec === null) {
    return privateError(
      "Use notation such as d6, 2d20+3, or 3d6-2. Limits: 100 dice, 1000 sides.",
    );
  }

  const result = rollDice(spec);
  return interactionResponse(formatRoll(spec, result));
}

async function handleInteraction(request: Request, env: Env): Promise<Response> {
  const config = readConfig(env);
  if (config === null) {
    return statusResponse(500, "Worker configuration is invalid.");
  }

  const body = await readBoundedBody(request);
  if (body === null) {
    return statusResponse(413, "Request body is too large.");
  }

  if (!(await verifyDiscordSignature(request, body, config.publicKey))) {
    return statusResponse(401, "Invalid request signature.");
  }

  let interaction: unknown;
  try {
    interaction = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return statusResponse(400, "Malformed JSON.");
  }
  if (!isRecord(interaction)) {
    return statusResponse(400, "Malformed interaction.");
  }

  if (interaction.type === DISCORD_PING) {
    if (
      interaction.application_id !== undefined &&
      interaction.application_id !== config.applicationId
    ) {
      return statusResponse(403, "Interaction application is not allowed.");
    }
    return jsonResponse({ type: DISCORD_PONG });
  }

  if (!hasExpectedScope(interaction, config)) {
    return statusResponse(403, "Interaction scope is not allowed.");
  }

  if (interaction.type !== DISCORD_APPLICATION_COMMAND) {
    return privateError("Unsupported interaction.");
  }

  return handleCommand(interaction);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      if (request.method !== "GET") {
        return statusResponse(405, "Method not allowed.", { allow: "GET" });
      }
      return jsonResponse({ status: "ok" });
    }

    if (url.pathname !== "/interactions") {
      return statusResponse(404, "Not found.");
    }

    if (request.method !== "POST") {
      return statusResponse(405, "Method not allowed.", { allow: "POST" });
    }

    return handleInteraction(request, env);
  },
} satisfies ExportedHandler<Env>;

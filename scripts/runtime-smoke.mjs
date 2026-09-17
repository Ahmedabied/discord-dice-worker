import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const applicationId = '111111111111111111';
const guildId = '222222222222222222';
const port = 8794;
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [
  'node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--ip', '127.0.0.1',
  '--port', String(port), '--inspector-port', '0',
  '--var', `DISCORD_PUBLIC_KEY:${publicHex}`,
  '--var', `DISCORD_APPLICATION_ID:${applicationId}`,
  '--var', `DISCORD_GUILD_ID:${guildId}`,
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', data => { output = (output + data).slice(-12000); });
child.stderr.on('data', data => { output = (output + data).slice(-12000); });

/** @param {unknown} payload */
async function send(payload, { tamper = false } = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const raw = JSON.stringify(payload);
  const signature = sign(null, Buffer.from(timestamp + raw), privateKey).toString('hex');
  return fetch(`${origin}/interactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature-timestamp': timestamp, 'x-signature-ed25519': signature },
    body: tamper ? `${raw} ` : raw,
  });
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw new Error(`Wrangler exited: ${output}`);
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(500) });
      if (response.ok) { ready = true; break; }
    } catch {}
    await delay(200);
  }
  assert(ready, `Local Worker did not become ready: ${output}`);
  const ping = await send({ type: 1 });
  assert.equal(ping.status, 200);
  assert.deepEqual(await ping.json(), { type: 1 });

  const command = {
    type: 2, application_id: applicationId, guild_id: guildId,
    data: { name: 'roll', type: 1, options: [{ name: 'notation', type: 3, value: '100d1000+1000000' }] },
  };
  const roll = await send(command);
  assert.equal(roll.status, 200);
  const result = /** @type {{type: number, data: {allowed_mentions: {parse: string[]}, content: string}}} */ (await roll.json());
  assert.equal(result.type, 4);
  assert.deepEqual(result.data.allowed_mentions, { parse: [] });
  assert.match(result.data.content, /^100d1000\+1000000: \[.*\] = [0-9]+$/);
  const match = result.data.content.match(/\[(.*)\]/);
  assert(match);
  const values = match[1].split(', ').map(Number);
  assert.equal(values.length, 100);
  assert(values.every(value => value >= 1 && value <= 1000));
  assert.equal(Number(result.data.content.split(' = ')[1]), values.reduce((a, b) => a + b, 1000000));

  assert.equal((await send(command, { tamper: true })).status, 401);
  command.data.options[0].value = '101d6';
  const invalid = await send(command);
  assert.equal(invalid.status, 200);
  assert.equal((await invalid.json()).data.flags, 64);
  console.log('PASS: local workerd signed PING, maximum roll, tampered signature, and private validation error.');
} finally {
  child.kill('SIGTERM');
  if (child.exitCode === null) {
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

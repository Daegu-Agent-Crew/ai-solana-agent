import assert from 'node:assert/strict';
import test from 'node:test';
import { createChallenge, verifyAuthorization } from '../src/index.js';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function bytesToBase58(bytes) {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      const value = digits[index] * 256 + carry;
      digits[index] = value % 58;
      carry = Math.floor(value / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    digits.push(0);
  }
  return digits.reverse().map((digit) => ALPHABET[digit]).join('');
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function signedChallenge() {
  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  const wallet = bytesToBase58(publicKey);
  const env = { UPLOAD_AUTH_SECRET: 'test-secret-with-at-least-32-random-bytes', AUTH_TTL_SECONDS: '300' };
  const challenge = await createChallenge(wallet, env);
  const signature = new Uint8Array(
    await crypto.subtle.sign('Ed25519', keyPair.privateKey, new TextEncoder().encode(challenge.message)),
  );
  return { wallet, env, challenge, signature: bytesToBase64(signature) };
}

test('accepts multipart CRLF normalization while verifying the canonical signed message', async () => {
  const { wallet, env, challenge, signature } = await signedChallenge();
  const multipartMessage = challenge.message.replace(/\n/g, '\r\n');

  await assert.doesNotReject(
    verifyAuthorization(wallet, multipartMessage, challenge.token, signature, env),
  );
});

test('rejects reuse by another wallet', async () => {
  const { wallet, env, challenge, signature } = await signedChallenge();
  const otherWallet = `${wallet.slice(0, -1)}${wallet.endsWith('1') ? '2' : '1'}`;

  await assert.rejects(
    verifyAuthorization(otherWallet, challenge.message, challenge.token, signature, env),
    /does not match the wallet/,
  );
});

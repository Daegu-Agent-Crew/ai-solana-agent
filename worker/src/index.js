const ALLOWED_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

function corsHeaders(origin, allowedOrigin) {
  const allowed = origin === allowedOrigin;
  return {
    'Access-Control-Allow-Origin': allowed ? origin : allowedOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(data, status, origin, env) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin, env.ALLOWED_ORIGIN),
    },
  });
}

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function base58ToBytes(value) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const map = new Map([...alphabet].map((char, index) => [char, index]));
  const bytes = [0];
  for (const char of value) {
    const digit = map.get(char);
    if (digit === undefined) throw new Error('Invalid Solana wallet address.');
    let carry = digit;
    for (let i = 0; i < bytes.length; i += 1) {
      const next = bytes[i] * 58 + carry;
      bytes[i] = next & 0xff;
      carry = next >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of value) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createChallenge(wallet, env) {
  if (!env.UPLOAD_AUTH_SECRET) throw new Error('UPLOAD_AUTH_SECRET is not configured.');
  const ttlSeconds = Number(env.AUTH_TTL_SECONDS || 300);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ttlSeconds * 1000;
  const nonce = crypto.randomUUID();
  const message = [
    'AI Solana Agent upload authorization',
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date(issuedAt).toISOString()}`,
    `Expires At: ${new Date(expiresAt).toISOString()}`,
  ].join('\n');
  const payload = bytesToBase64(new TextEncoder().encode(JSON.stringify({ wallet, message, expiresAt })));
  const mac = await hmacHex(env.UPLOAD_AUTH_SECRET, payload);
  return { message, token: `${payload}.${mac}`, expiresAt };
}

function normalizeMessageLineEndings(value) {
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export async function verifyAuthorization(wallet, message, token, signatureBase64, env) {
  if (!env.UPLOAD_AUTH_SECRET) throw new Error('UPLOAD_AUTH_SECRET is not configured.');
  const [payload, suppliedMac] = String(token || '').split('.');
  if (!payload || !suppliedMac) throw new Error('Upload authorization token is missing.');
  const expectedMac = await hmacHex(env.UPLOAD_AUTH_SECRET, payload);
  if (!timingSafeEqual(expectedMac, suppliedMac)) throw new Error('Upload authorization token is invalid.');

  let challenge;
  try {
    challenge = JSON.parse(new TextDecoder().decode(base64ToBytes(payload)));
  } catch {
    throw new Error('Upload authorization payload is invalid.');
  }
  if (challenge.wallet !== wallet) throw new Error('Upload authorization does not match the wallet.');
  if (challenge.message !== normalizeMessageLineEndings(message)) {
    throw new Error('Upload authorization message is invalid.');
  }
  if (!Number.isFinite(challenge.expiresAt) || Date.now() > challenge.expiresAt) throw new Error('Upload authorization expired.');

  const publicKeyBytes = base58ToBytes(wallet);
  if (publicKeyBytes.length !== 32) throw new Error('Solana wallet public key must be 32 bytes.');
  const signatureBytes = base64ToBytes(signatureBase64 || '');
  if (signatureBytes.length !== 64) throw new Error('Wallet signature must be 64 bytes.');

  const publicKey = await crypto.subtle.importKey('raw', publicKeyBytes, { name: 'Ed25519' }, false, ['verify']);
  const verified = await crypto.subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    signatureBytes,
    new TextEncoder().encode(challenge.message),
  );
  if (!verified) throw new Error('Wallet signature verification failed.');
}

async function enforceRateLimit(wallet, env) {
  const dailyLimit = Number(env.DAILY_UPLOAD_LIMIT || 10);
  const minInterval = Number(env.MIN_UPLOAD_INTERVAL_SECONDS || 30);
  const today = new Date().toISOString().slice(0, 10);

  if (env.UPLOAD_LIMITS) {
    const key = `wallet:${wallet}:${today}`;
    const current = JSON.parse((await env.UPLOAD_LIMITS.get(key)) || '{"count":0,"lastAt":0}');
    if (Date.now() - Number(current.lastAt || 0) < minInterval * 1000) {
      throw new Error(`Please wait ${minInterval} seconds before another upload.`);
    }
    if (Number(current.count || 0) >= dailyLimit) throw new Error(`Daily upload limit reached (${dailyLimit}).`);
    await env.UPLOAD_LIMITS.put(key, JSON.stringify({ count: Number(current.count || 0) + 1, lastAt: Date.now() }), {
      expirationTtl: 172800,
    });
    return;
  }

  const cache = caches.default;
  const cooldownUrl = `https://rate-limit.local/${encodeURIComponent(wallet)}`;
  const cached = await cache.match(cooldownUrl);
  if (cached) throw new Error(`Please wait ${minInterval} seconds before another upload.`);
  await cache.put(cooldownUrl, new Response('1', { headers: { 'Cache-Control': `max-age=${minInterval}` } }));
}

async function githubCreateFile(env, path, contentBase64, message) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'ai-solana-upload-worker',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ message, content: contentBase64, branch: env.GITHUB_BRANCH }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GitHub upload failed (${response.status}): ${body.message || 'unknown error'}`);
  return body;
}

export async function waitUntilPublic(url, expectedType, attempts = 8) {
  let lastStatus = 0;
  let lastType = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(`${url}?v=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } }).catch(() => null);
    lastStatus = response?.status || 0;
    const type = response?.headers.get('content-type') || '';
    lastType = type;
    if (response?.ok) {
      if (!expectedType || type.includes(expectedType)) return { status: response.status, type };
      if (expectedType === 'application/json') {
        const body = await response.clone().json().catch(() => null);
        if (body && typeof body === 'object') return { status: response.status, type };
      }
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 750, 3000)));
    }
  }
  throw new Error(`Uploaded file is not publicly available yet: HTTP ${lastStatus}, Content-Type ${lastType || 'unknown'}`);
}

async function handleUpload(request, env, origin) {
  if (!env.GITHUB_TOKEN) return json({ ok: false, error: 'GITHUB_TOKEN secret is not configured.' }, 500, origin, env);
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) return json({ ok: false, error: 'multipart/form-data is required.' }, 415, origin, env);

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return json({ ok: false, error: 'file is required.' }, 400, origin, env);
  const extension = ALLOWED_TYPES.get(file.type);
  if (!extension) return json({ ok: false, error: 'Only JPEG, PNG, and WebP images are allowed.' }, 415, origin, env);

  const maxFileSize = Number(env.MAX_FILE_SIZE || 5242880);
  if (file.size < 1 || file.size > maxFileSize) {
    return json({ ok: false, error: `File size must be between 1 byte and ${maxFileSize} bytes.` }, 413, origin, env);
  }

  const name = cleanText(form.get('name'), 64);
  const symbol = cleanText(form.get('symbol') || 'AISOL', 10).toUpperCase();
  const description = cleanText(form.get('description'), 500);
  const wallet = cleanText(form.get('wallet'), 64);
  const authMessage = String(form.get('authMessage') || '');
  const authToken = String(form.get('authToken') || '');
  const signature = String(form.get('signature') || '');

  if (!name) return json({ ok: false, error: 'name is required.' }, 400, origin, env);
  if (new TextEncoder().encode(name).length > 32) return json({ ok: false, error: 'name exceeds 32 UTF-8 bytes.' }, 400, origin, env);
  if (!symbol || new TextEncoder().encode(symbol).length > 10) return json({ ok: false, error: 'symbol must be 1-10 UTF-8 bytes.' }, 400, origin, env);
  if (!wallet) return json({ ok: false, error: 'Connected wallet is required.' }, 401, origin, env);

  await verifyAuthorization(wallet, authMessage, authToken, signature, env);
  await enforceRateLimit(wallet, env);

  const imageBytes = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256Hex(imageBytes);
  const id = `${Date.now()}-${hash.slice(0, 12)}`;
  const imagePath = `uploads/images/${id}.${extension}`;
  const metadataPath = `uploads/metadata/${id}.json`;
  const rawBase = `https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${env.GITHUB_BRANCH}`;
  const imageUrl = `${rawBase}/${imagePath}`;
  const metadataUri = `${rawBase}/${metadataPath}`;

  await githubCreateFile(env, imagePath, bytesToBase64(imageBytes), `Add NFT image ${id}`);
  const metadata = {
    name,
    symbol,
    description,
    image: imageUrl,
    attributes: [
      { trait_type: 'Network', value: 'Solana Devnet' },
      { trait_type: 'Storage', value: 'GitHub' },
      { trait_type: 'Uploader Wallet', value: wallet },
      { trait_type: 'SHA-256', value: hash },
    ],
    properties: { category: 'image', files: [{ uri: imageUrl, type: file.type }] },
  };
  const metadataBytes = new TextEncoder().encode(`${JSON.stringify(metadata, null, 2)}\n`);
  await githubCreateFile(env, metadataPath, bytesToBase64(metadataBytes), `Add NFT metadata ${id}`);

  const [imagePublic, metadataPublic] = await Promise.all([
    waitUntilPublic(imageUrl, file.type),
    waitUntilPublic(metadataUri, 'application/json'),
  ]);

  return json({
    ok: true,
    id,
    imageUrl,
    metadataUri,
    imagePath,
    metadataPath,
    sha256: hash,
    size: file.size,
    mimeType: file.type,
    imagePublic,
    metadataPublic,
  }, 201, origin, env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin') || '';
    if (request.method === 'OPTIONS') {
      if (origin !== env.ALLOWED_ORIGIN) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin, env.ALLOWED_ORIGIN) });
    }
    if (origin && origin !== env.ALLOWED_ORIGIN) return json({ ok: false, error: 'Origin not allowed.' }, 403, origin, env);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json({
        ok: true,
        service: 'ai-solana-upload',
        storage: 'github',
        walletAuth: Boolean(env.UPLOAD_AUTH_SECRET),
        persistentRateLimit: Boolean(env.UPLOAD_LIMITS),
      }, 200, origin, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/challenge') {
      try {
        const wallet = cleanText(url.searchParams.get('wallet'), 64);
        if (!wallet) return json({ ok: false, error: 'wallet is required.' }, 400, origin, env);
        base58ToBytes(wallet);
        return json({ ok: true, ...(await createChallenge(wallet, env)) }, 200, origin, env);
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400, origin, env);
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/upload') {
      try {
        return await handleUpload(request, env, origin);
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400, origin, env);
      }
    }
    return json({ ok: false, error: 'Not found.' }, 404, origin, env);
  },
};

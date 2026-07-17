const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = origin === env.ALLOWED_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Wallet, X-Timestamp, X-Nonce, X-Signature',
    'Vary': 'Origin',
  };
}

function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(request, env), 'Cache-Control': 'no-store' },
  });
}

function fail(request, env, message, status = 400) {
  return json(request, env, { success: false, error: message }, status);
}

function decodeBase58(value) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes = [0];
  for (const char of value) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error('Invalid base58 value');
    let carry = digit;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
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
  return new Uint8Array(bytes.reverse());
}

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function isSolanaAddress(value) {
  try {
    return decodeBase58(String(value)).length === 32;
  } catch {
    return false;
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(String(value)).protocol === 'https:';
  } catch {
    return false;
  }
}

function authMessage(action, wallet, timestamp, nonce) {
  return `CouponNFT DApp4\nAction: ${action}\nWallet: ${wallet}\nTimestamp: ${timestamp}\nNonce: ${nonce}`;
}

async function requireWalletAuth(request, env, action) {
  const wallet = request.headers.get('X-Wallet') || '';
  const timestamp = request.headers.get('X-Timestamp') || '';
  const nonce = request.headers.get('X-Nonce') || '';
  const signature = request.headers.get('X-Signature') || '';
  if (!wallet || !timestamp || !nonce || !signature) throw new Response('Missing wallet authorization', { status: 401 });
  const time = Number(timestamp);
  if (!Number.isFinite(time) || Math.abs(Date.now() - time) > MAX_CLOCK_SKEW_MS) {
    throw new Response('Wallet authorization expired', { status: 401 });
  }
  if (!/^[a-f0-9-]{20,80}$/i.test(nonce)) throw new Response('Invalid authorization nonce', { status: 401 });
  const replayKey = `auth:${wallet}:${nonce}`;
  if (await env.KV.get(replayKey)) throw new Response('Authorization already used', { status: 409 });
  try {
    const keyBytes = decodeBase58(wallet);
    if (keyBytes.length !== 32) throw new Error('Invalid wallet key');
    const publicKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'Ed25519' }, false, ['verify']);
    const valid = await crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      decodeBase64(signature),
      new TextEncoder().encode(authMessage(action, wallet, timestamp, nonce)),
    );
    if (!valid) throw new Error('Invalid signature');
  } catch {
    throw new Response('Invalid wallet signature', { status: 401 });
  }
  await env.KV.put(replayKey, '1', { expirationTtl: 300 });
  return wallet;
}

async function readBody(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new Response('Invalid JSON body', { status: 400 });
  return body;
}

async function verifyRedeemTransaction(env, signature, wallet, assetAddress, otp) {
  const response = await fetch(env.SOLANA_RPC_URL, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getTransaction',
      params: [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }],
    }),
  });
  const payload = await response.json();
  const tx = payload?.result;
  if (!tx || tx.meta?.err) return false;
  const keys = tx.transaction?.message?.accountKeys || [];
  const signedByWallet = keys.some((key) => (key.pubkey || key) === wallet && key.signer !== false);
  const expected = `COUPON_REDEEM:${assetAddress}:${otp}`;
  const instructions = tx.transaction?.message?.instructions || [];
  const hasMemo = instructions.some((ix) =>
    (ix.program === 'spl-memo' || ix.programId === MEMO_PROGRAM) && ix.parsed === expected);
  return signedByWallet && hasMemo;
}

async function getStoreByOwner(env, wallet) {
  return env.DB.prepare('SELECT * FROM stores WHERE owner_wallet = ?').bind(wallet).first();
}

async function handle(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (pathname === '/health' && request.method === 'GET') {
    return json(request, env, { success: true, service: 'coupon-loop-api', network: 'devnet', time: new Date().toISOString() });
  }

  if (pathname === '/api/ranking' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT wallet_address, nickname, total_scans, last_active FROM users ORDER BY total_scans DESC, last_active DESC LIMIT 100',
    ).all();
    return json(request, env, { success: true, ranking: results });
  }

  if (pathname === '/api/coupons' && request.method === 'GET') {
    const owner = url.searchParams.get('owner');
    const storeOwner = url.searchParams.get('storeOwner');
    let query;
    if (owner) {
      query = env.DB.prepare('SELECT c.*, s.name AS store_name FROM coupons c JOIN stores s ON s.id = c.store_id WHERE c.owner_wallet = ? ORDER BY c.created_at DESC').bind(owner);
    } else if (storeOwner) {
      query = env.DB.prepare('SELECT c.*, s.name AS store_name FROM coupons c JOIN stores s ON s.id = c.store_id WHERE s.owner_wallet = ? ORDER BY c.created_at DESC').bind(storeOwner);
    } else return fail(request, env, 'owner or storeOwner is required', 422);
    const { results } = await query.all();
    return json(request, env, { success: true, coupons: results });
  }

  if (pathname === '/api/stores' && request.method === 'POST') {
    const wallet = await requireWalletAuth(request, env, 'register-store');
    const body = await readBody(request);
    const name = String(body.name || '').trim().slice(0, 80);
    if (!name) return fail(request, env, 'Store name is required', 422);
    const existing = await getStoreByOwner(env, wallet);
    const id = existing?.id || crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO stores (id, name, owner_wallet, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_wallet) DO UPDATE SET name = excluded.name',
    ).bind(id, name, wallet, Date.now()).run();
    return json(request, env, { success: true, store: { id, name, owner_wallet: wallet } }, existing ? 200 : 201);
  }

  if (pathname === '/api/coupons' && request.method === 'POST') {
    const wallet = await requireWalletAuth(request, env, 'register-coupon');
    const store = await getStoreByOwner(env, wallet);
    if (!store) return fail(request, env, 'Register a store first', 403);
    const body = await readBody(request);
    const required = ['assetAddress', 'ownerWallet', 'name', 'metadataUri', 'mintTx', 'expiresAt'];
    if (required.some((key) => !body[key])) return fail(request, env, `Missing required coupon fields`, 422);
    if (!isSolanaAddress(body.assetAddress) || !isSolanaAddress(body.ownerWallet)) {
      return fail(request, env, 'Invalid Solana asset or owner address', 422);
    }
    if (!isHttpsUrl(body.metadataUri) || (body.imageUrl && !isHttpsUrl(body.imageUrl))) {
      return fail(request, env, 'Metadata and image URLs must use HTTPS', 422);
    }
    if (!Number.isFinite(Number(body.expiresAt)) || Number(body.expiresAt) <= Date.now()) {
      return fail(request, env, 'Coupon expiry must be in the future', 422);
    }
    await env.DB.prepare(
      `INSERT INTO coupons
       (asset_address, store_id, owner_wallet, name, benefit, image_url, metadata_uri, status, expires_at, mint_tx, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    ).bind(
      String(body.assetAddress), store.id, String(body.ownerWallet), String(body.name).slice(0, 100),
      String(body.benefit || '').slice(0, 120), String(body.imageUrl || '').slice(0, 500),
      String(body.metadataUri).slice(0, 500), Number(body.expiresAt), String(body.mintTx), Date.now(),
    ).run();
    return json(request, env, { success: true, assetAddress: body.assetAddress }, 201);
  }

  if (pathname === '/api/coupon/otp' && request.method === 'POST') {
    const wallet = await requireWalletAuth(request, env, 'create-otp');
    const body = await readBody(request);
    const coupon = await env.DB.prepare(
      'SELECT c.*, s.owner_wallet AS store_owner FROM coupons c JOIN stores s ON s.id = c.store_id WHERE c.asset_address = ?',
    ).bind(String(body.assetAddress || '')).first();
    if (!coupon || coupon.store_owner !== wallet) return fail(request, env, 'Coupon not found or store authority mismatch', 403);
    if (coupon.status !== 'active' || coupon.expires_at < Date.now()) return fail(request, env, 'Coupon is not active', 409);
    const otp = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
    const ttl = Math.max(60, Math.min(300, Number(env.OTP_TTL_SECONDS) || 180));
    await env.KV.put(`otp:${otp}`, JSON.stringify({ assetAddress: coupon.asset_address, storeId: coupon.store_id }), { expirationTtl: ttl });
    return json(request, env, { success: true, otp, expiresIn: ttl, assetAddress: coupon.asset_address });
  }

  if (pathname === '/api/coupon/redeem' && request.method === 'POST') {
    const wallet = await requireWalletAuth(request, env, 'redeem-coupon');
    const body = await readBody(request);
    const assetAddress = String(body.assetAddress || '');
    const otp = String(body.otp || '').toUpperCase();
    const txSignature = String(body.txSignature || '');
    const otpData = await env.KV.get(`otp:${otp}`, 'json');
    if (!otpData || otpData.assetAddress !== assetAddress) return fail(request, env, 'OTP is invalid or expired', 410);
    const coupon = await env.DB.prepare('SELECT * FROM coupons WHERE asset_address = ?').bind(assetAddress).first();
    if (!coupon || coupon.owner_wallet !== wallet) return fail(request, env, 'Coupon owner mismatch', 403);
    if (coupon.status !== 'active') return fail(request, env, 'Coupon was already used', 409);
    if (coupon.expires_at < Date.now()) return fail(request, env, 'Coupon has expired', 410);
    if (!await verifyRedeemTransaction(env, txSignature, wallet, assetAddress, otp)) {
      return fail(request, env, 'Confirmed Solana redeem memo was not found', 422);
    }
    const now = Date.now();
    const update = await env.DB.prepare(
      "UPDATE coupons SET status = 'used', redeemed_at = ?, redeem_tx = ? WHERE asset_address = ? AND status = 'active'",
    ).bind(now, txSignature, assetAddress).run();
    if (!update.meta?.changes) return fail(request, env, 'Coupon was already used', 409);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO redemptions (id, asset_address, store_id, wallet_address, tx_signature, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), assetAddress, coupon.store_id, wallet, txSignature, now),
      env.DB.prepare(`INSERT INTO users (wallet_address, nickname, total_scans, last_active)
        VALUES (?, ?, 1, ?) ON CONFLICT(wallet_address) DO UPDATE SET total_scans = total_scans + 1, last_active = excluded.last_active`)
        .bind(wallet, `User ${wallet.slice(0, 4)}`, now),
    ]);
    await env.KV.delete(`otp:${otp}`);
    return json(request, env, { success: true, assetAddress, status: 'used', redeemedAt: now });
  }

  if (pathname === '/api/coupon/freeze' && request.method === 'POST') {
    const wallet = await requireWalletAuth(request, env, 'confirm-freeze');
    const body = await readBody(request);
    const coupon = await env.DB.prepare(
      'SELECT c.*, s.owner_wallet AS store_owner FROM coupons c JOIN stores s ON s.id = c.store_id WHERE c.asset_address = ?',
    ).bind(String(body.assetAddress || '')).first();
    if (!coupon || coupon.store_owner !== wallet || coupon.status !== 'used') return fail(request, env, 'Freeze confirmation is not allowed', 403);
    await env.DB.prepare('UPDATE coupons SET frozen_at = ?, freeze_tx = ? WHERE asset_address = ?')
      .bind(Date.now(), String(body.freezeTx || ''), coupon.asset_address).run();
    return json(request, env, { success: true, assetAddress: coupon.asset_address, frozen: true });
  }

  return fail(request, env, 'Not found', 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      if (error instanceof Response) return fail(request, env, await error.text(), error.status);
      console.error(error);
      return fail(request, env, 'Internal server error', 500);
    }
  },
};

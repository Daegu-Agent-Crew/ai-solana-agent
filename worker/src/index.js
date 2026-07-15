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

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
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
    body: JSON.stringify({
      message,
      content: contentBase64,
      branch: env.GITHUB_BRANCH,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`GitHub upload failed (${response.status}): ${body.message || 'unknown error'}`);
  }
  return body;
}

async function handleUpload(request, env, origin) {
  if (!env.GITHUB_TOKEN) {
    return json({ ok: false, error: 'GITHUB_TOKEN secret is not configured.' }, 500, origin, env);
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return json({ ok: false, error: 'multipart/form-data is required.' }, 415, origin, env);
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return json({ ok: false, error: 'file is required.' }, 400, origin, env);
  }

  const extension = ALLOWED_TYPES.get(file.type);
  if (!extension) {
    return json({ ok: false, error: 'Only JPEG, PNG, and WebP images are allowed.' }, 415, origin, env);
  }

  const maxFileSize = Number(env.MAX_FILE_SIZE || 5242880);
  if (file.size < 1 || file.size > maxFileSize) {
    return json({ ok: false, error: `File size must be between 1 byte and ${maxFileSize} bytes.` }, 413, origin, env);
  }

  const name = cleanText(form.get('name'), 64);
  const symbol = cleanText(form.get('symbol') || 'AISOL', 10).toUpperCase();
  const description = cleanText(form.get('description'), 500);
  const wallet = cleanText(form.get('wallet'), 64);

  if (!name) return json({ ok: false, error: 'name is required.' }, 400, origin, env);
  if (new TextEncoder().encode(name).length > 32) {
    return json({ ok: false, error: 'name exceeds 32 UTF-8 bytes.' }, 400, origin, env);
  }
  if (!symbol || new TextEncoder().encode(symbol).length > 10) {
    return json({ ok: false, error: 'symbol must be 1-10 UTF-8 bytes.' }, 400, origin, env);
  }

  const imageBytes = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256Hex(imageBytes);
  const id = `${Date.now()}-${hash.slice(0, 12)}`;
  const imagePath = `uploads/images/${id}.${extension}`;
  const metadataPath = `uploads/metadata/${id}.json`;
  const rawBase = `https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${env.GITHUB_BRANCH}`;
  const imageUrl = `${rawBase}/${imagePath}`;
  const metadataUri = `${rawBase}/${metadataPath}`;

  await githubCreateFile(
    env,
    imagePath,
    bytesToBase64(imageBytes),
    `Add NFT image ${id}`,
  );

  const metadata = {
    name,
    symbol,
    description,
    image: imageUrl,
    attributes: [
      { trait_type: 'Network', value: 'Solana Devnet' },
      { trait_type: 'Storage', value: 'GitHub' },
      ...(wallet ? [{ trait_type: 'Uploader Wallet', value: wallet }] : []),
    ],
    properties: {
      category: 'image',
      files: [{ uri: imageUrl, type: file.type }],
    },
  };

  await githubCreateFile(
    env,
    metadataPath,
    btoa(unescape(encodeURIComponent(`${JSON.stringify(metadata, null, 2)}\n`))),
    `Add NFT metadata ${id}`,
  );

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

    if (origin && origin !== env.ALLOWED_ORIGIN) {
      return json({ ok: false, error: 'Origin not allowed.' }, 403, origin, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json({ ok: true, service: 'ai-solana-upload', storage: 'github' }, 200, origin, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/upload') {
      try {
        return await handleUpload(request, env, origin);
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500, origin, env);
      }
    }

    return json({ ok: false, error: 'Not found.' }, 404, origin, env);
  },
};

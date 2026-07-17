PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_wallet TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  wallet_address TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  total_scans INTEGER NOT NULL DEFAULT 0,
  last_active INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS coupons (
  asset_address TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  owner_wallet TEXT NOT NULL,
  name TEXT NOT NULL,
  benefit TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  metadata_uri TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'used', 'expired')),
  expires_at INTEGER NOT NULL,
  mint_tx TEXT NOT NULL,
  redeemed_at INTEGER,
  redeem_tx TEXT,
  frozen_at INTEGER,
  freeze_tx TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE TABLE IF NOT EXISTS redemptions (
  id TEXT PRIMARY KEY,
  asset_address TEXT NOT NULL UNIQUE,
  store_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  tx_signature TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (asset_address) REFERENCES coupons(asset_address),
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE INDEX IF NOT EXISTS idx_users_scans_active
  ON users(total_scans DESC, last_active DESC);
CREATE INDEX IF NOT EXISTS idx_coupons_owner_status
  ON coupons(owner_wallet, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coupons_store_status
  ON coupons(store_id, status, created_at DESC);

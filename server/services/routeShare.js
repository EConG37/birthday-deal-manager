const crypto = require('crypto');

/**
 * 路线分享快照（内存）。
 * 与已删除的 routePreview 区别：面向好友分享场景，TTL 7 天；
 * 入库时由调用方剔除 birthday 等隐私字段。
 * 单实例内存存储，重启丢失；多实例部署时需外置（见 doc 13）。
 */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const store = new Map();

function prune() {
  const now = Date.now();
  store.forEach((entry, id) => {
    if (now - entry.createdAt > TTL_MS) store.delete(id);
  });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
}

function create(data) {
  const id = crypto.randomBytes(18).toString('hex');
  const entry = {
    id,
    data,
    createdAt: Date.now(),
    expiresAt: new Date(Date.now() + TTL_MS).toISOString()
  };
  store.set(id, entry);
  prune();
  return { id, expiresAt: entry.expiresAt };
}

function get(id) {
  const entry = store.get(id);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    store.delete(id);
    return null;
  }
  return Object.assign({}, entry.data, { expires_at: entry.expiresAt });
}

module.exports = { create, get };

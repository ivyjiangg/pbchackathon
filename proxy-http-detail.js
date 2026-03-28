'use strict';

/**
 * Parse JSON error bodies from aegis-proxy (403 policy denied, etc.) for demo UX.
 */
function parseProxyErrorBody(body) {
  if (!body || typeof body !== 'string') return null;
  const s = body.trim();
  if (!s.startsWith('{')) return null;
  try {
    const j = JSON.parse(s);
    if (j.error === 'policy denied' && j.reason) {
      let out = j.reason;
      if (j.keyword) out += ` (keyword: ${j.keyword})`;
      return out;
    }
    if (j.error && typeof j.error === 'string') return j.error;
  } catch (_) {
    /* ignore */
  }
  return null;
}

module.exports = { parseProxyErrorBody };

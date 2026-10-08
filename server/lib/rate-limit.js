'use strict'

/**
 * Small fixed-window rate limiter keyed by client IP.
 *
 * State is per-process, so on serverless platforms the effective limit is a
 * lower bound rather than a hard cap. It still stops a single misbehaving
 * client from looping requests, and costs nothing to run.
 */
const buckets = new Map()

function clientKey(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim()
  }
  return req.ip || req.socket?.remoteAddress || 'unknown'
}

// Prevents unbounded growth of the bucket map on a long-lived process.
const MAX_BUCKETS = 10000

function hit(req, { windowMs, max }) {
  const now = Date.now()
  const key = clientKey(req)
  const entry = buckets.get(key)

  if (!entry || now >= entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    if (buckets.size > MAX_BUCKETS) prune(now)
    return { allowed: true, remaining: max - 1, retryAfterSeconds: 0 }
  }

  entry.count += 1
  const allowed = entry.count <= max
  return {
    allowed,
    remaining: Math.max(0, max - entry.count),
    retryAfterSeconds: allowed ? 0 : Math.ceil((entry.resetAt - now) / 1000),
  }
}

function prune(now) {
  for (const [key, entry] of buckets) {
    if (now >= entry.resetAt) buckets.delete(key)
  }
}

function reset() {
  buckets.clear()
}

module.exports = { hit, reset }
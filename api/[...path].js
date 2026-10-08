'use strict'

// Single Vercel entry point for every /api/* route. Vercel maps function paths
// from the filesystem, so /api/summarize, /api/transcribe and /api/health are
// all handled here by the same Express app used in local development.
const { createApp } = require('../server/app')

const app = createApp()

module.exports = (req, res) => app(req, res)
'use strict';

const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');

const ROOT = __dirname;

let running = false;
let output = '';
let lastCode = null;

function getNodeCmd() {
  return process.platform === 'win32' ? 'node.exe' : 'node';
}

function appendOutput(chunk) {
  output += chunk;
  if (output.length > 120000) output = output.slice(-80000);
}

function startScript(relPath) {
  if (running) {
    return { ok: false, error: 'Another script is already running' };
  }
  running = true;
  output = '';
  lastCode = null;

  const full = path.join(ROOT, relPath);
  const node = getNodeCmd();

  const child = spawn(node, [full], {
    cwd: ROOT,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (d) => appendOutput(d.toString()));
  child.stderr.on('data', (d) => appendOutput(d.toString()));

  child.on('close', (code) => {
    running = false;
    lastCode = code == null ? -1 : code;
  });

  child.on('error', (err) => {
    running = false;
    lastCode = -1;
    appendOutput(`\n${String(err.message || err)}`);
  });

  return { ok: true };
}

function getScriptStatus() {
  return { running, output, lastCode };
}

async function readProofJson() {
  const p = path.join(ROOT, 'docs', 'proofs', 'devnet-proof.json');
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = {
  startScript,
  getScriptStatus,
  readProofJson,
  startSmoke: () => startScript('scripts/smoke-test.mjs'),
  startProof: () => startScript('scripts/strict-devnet-proof.mjs'),
};

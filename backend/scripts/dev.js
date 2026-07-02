#!/usr/bin/env node
// Dev orchestrator: brings up the Mongo SSH tunnel and the API server together.
//
//   npm run dev          -> tunnel (if not already up) + nodemon src/server.js
//   npm run dev:server   -> nodemon only (tunnel managed elsewhere)
//
// If port 27017 is already listening (external tunnel or local Mongo), the
// tunnel step is skipped and only the server starts.

const { spawn } = require("child_process");
const net = require("net");
const path = require("path");

const BACKEND_ROOT = path.dirname(__dirname);
const TUNNEL_PORT = Number(process.env.DB_TUNNEL_LOCAL_PORT || 27017);
const TUNNEL_WAIT_MS = 30000;

let tunnel = null;
let server = null;
let shuttingDown = false;

function isPortListening(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port, timeout: 700 });
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("error", () => resolve(false));
    sock.once("timeout", () => { sock.destroy(); resolve(false); });
  });
}

async function waitForPort(port, deadlineMs) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (await isPortListening(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return isPortListening(port);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (server && server.exitCode === null) server.kill();
  if (tunnel && tunnel.exitCode === null) tunnel.kill();
  process.exit(code);
}

async function main() {
  if (await isPortListening(TUNNEL_PORT)) {
    console.log(`[dev] Mongo already reachable on 127.0.0.1:${TUNNEL_PORT} — skipping tunnel.`);
  } else {
    console.log("[dev] Starting Mongo SSH tunnel...");
    tunnel = spawn("python", [path.join("scripts", "db-tunnel.py")], {
      cwd: BACKEND_ROOT,
      stdio: "inherit",
    });
    tunnel.on("error", (err) => {
      console.error(`[dev] Could not start the tunnel (${err.message}). Is Python installed?`);
      shutdown(1);
    });
    tunnel.on("exit", (code) => {
      if (shuttingDown) return;
      console.error(`[dev] Tunnel exited (code ${code}) — stopping the server.`);
      shutdown(code === 0 ? 0 : 1);
    });

    if (!(await waitForPort(TUNNEL_PORT, TUNNEL_WAIT_MS))) {
      console.error(`[dev] Tunnel did not come up on 127.0.0.1:${TUNNEL_PORT} within ${TUNNEL_WAIT_MS / 1000}s.`);
      shutdown(1);
      return;
    }
    console.log("[dev] Tunnel ready.");
  }

  const nodemonBin = require.resolve("nodemon/bin/nodemon.js", { paths: [BACKEND_ROOT] });
  server = spawn(process.execPath, [nodemonBin, path.join("src", "server.js")], {
    cwd: BACKEND_ROOT,
    stdio: "inherit",
  });
  server.on("exit", (code) => shutdown(code === null ? 1 : code));
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

main().catch((err) => {
  console.error(err);
  shutdown(1);
});

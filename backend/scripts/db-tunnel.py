"""SSH tunnel to the VPS MongoDB for local development.

MongoDB on the VPS is bound to 127.0.0.1 (not exposed to the internet), so local
development reaches it through this tunnel: 127.0.0.1:27017 -> VPS 127.0.0.1:27017.

Reads VPS_USER / VPS_IP / VPS_PASSWORD from backend/.env. Requires paramiko:
    pip install paramiko

Usage: npm run db:tunnel  (leave it running while the backend is up)
"""
import os
import select
import socket
import socketserver
import sys
import threading

import paramiko

BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_PORT = int(os.environ.get("DB_TUNNEL_LOCAL_PORT", "27017"))
REMOTE_HOST, REMOTE_PORT = "127.0.0.1", 27017


def load_env():
    env = {}
    with open(os.path.join(BACKEND_ROOT, ".env"), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                env[key.strip()] = value.strip()
    return env


class ForwardServer(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            chan = self.server.transport.open_channel(
                "direct-tcpip", (REMOTE_HOST, REMOTE_PORT), self.request.getpeername()
            )
        except Exception as exc:
            print(f"Channel open failed: {exc}", file=sys.stderr)
            return
        try:
            while True:
                r, _, _ = select.select([self.request, chan], [], [])
                if self.request in r:
                    data = self.request.recv(16384)
                    if not data:
                        break
                    chan.sendall(data)
                if chan in r:
                    data = chan.recv(16384)
                    if not data:
                        break
                    self.request.sendall(data)
        finally:
            chan.close()
            self.request.close()


def main():
    env = load_env()
    user, host, password = env.get("VPS_USER"), env.get("VPS_IP"), env.get("VPS_PASSWORD")
    if not (user and host and password):
        sys.exit("VPS_USER, VPS_IP and VPS_PASSWORD must be set in backend/.env")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username=user, password=password, timeout=15,
                   allow_agent=False, look_for_keys=False)
    transport = client.get_transport()
    transport.set_keepalive(30)

    server = ForwardServer(("127.0.0.1", LOCAL_PORT), Handler)
    server.transport = transport
    print(f"Tunnel up: mongodb://127.0.0.1:{LOCAL_PORT} -> {host}:{REMOTE_PORT} (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        client.close()


if __name__ == "__main__":
    main()

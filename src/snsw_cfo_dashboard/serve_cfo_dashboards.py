#!/usr/bin/env python3
"""Persistent local CFO dashboard server.

Serves /Users/snswcommunications/Hermes-CFO/briefings/dashboards on 127.0.0.1:8770.
Designed for launchd KeepAlive so Kyle's dashboard links keep working after sleeps/restarts.
"""
from __future__ import annotations

import functools
import http.server
import os
import socketserver
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path('/Users/snswcommunications/Hermes-CFO/briefings/dashboards')
HOST = os.environ.get('CFO_DASH_HOST', '127.0.0.1')
PORT = int(os.environ.get('CFO_DASH_PORT', '8770'))

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stdout.write(f"{datetime.now().isoformat(timespec='seconds')} {self.address_string()} {fmt % args}\n")
        sys.stdout.flush()

class ReusableTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> int:
    if not ROOT.exists():
        raise SystemExit(f'Dashboard root missing: {ROOT}')
    handler = functools.partial(Handler, directory=str(ROOT))
    with ReusableTCPServer((HOST, PORT), handler) as httpd:
        print(f"CFO dashboard server serving {ROOT} at http://{HOST}:{PORT}/cfo-command-centre.html", flush=True)
        httpd.serve_forever()
    return 0

if __name__ == '__main__':
    raise SystemExit(main())

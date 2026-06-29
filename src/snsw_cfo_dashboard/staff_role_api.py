#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import json, datetime, urllib.parse

DATA_DIR = Path('/Users/snswcommunications/Hermes-CFO/finance/payroll-staff-costs')
OVERRIDES = DATA_DIR / 'staff-role-overrides.json'
MATCHES = DATA_DIR / 'current_25_26_staff_allocation_match.csv'
PORT = 8767

DATA_DIR.mkdir(parents=True, exist_ok=True)
if not OVERRIDES.exists():
    OVERRIDES.write_text(json.dumps({'updated_at': None, 'roles': {}}, indent=2), encoding='utf-8')

class Handler(BaseHTTPRequestHandler):
    def _headers(self, status=200, ctype='application/json'):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    def do_OPTIONS(self):
        self._headers(204)
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/roles':
            self._headers()
            self.wfile.write(OVERRIDES.read_bytes())
        elif parsed.path == '/health':
            self._headers()
            self.wfile.write(json.dumps({'ok': True, 'file': str(OVERRIDES)}).encode())
        else:
            self._headers(404)
            self.wfile.write(b'{"error":"not found"}')
    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != '/roles':
            self._headers(404); self.wfile.write(b'{"error":"not found"}'); return
        length = int(self.headers.get('Content-Length', 0))
        try:
            incoming = json.loads(self.rfile.read(length) or b'{}')
            roles = incoming.get('roles', incoming)
            if not isinstance(roles, dict):
                raise ValueError('roles must be an object')
            existing = json.loads(OVERRIDES.read_text(encoding='utf-8')) if OVERRIDES.exists() else {'roles': {}}
            existing_roles = existing.get('roles', {})
            # Merge; blank role/category/comment means keep record but user can see it was considered.
            for staff_id, value in roles.items():
                if isinstance(value, dict):
                    existing_roles[str(staff_id)] = value
            payload = {'updated_at': datetime.datetime.now().isoformat(timespec='seconds'), 'roles': existing_roles}
            OVERRIDES.write_text(json.dumps(payload, indent=2), encoding='utf-8')
            self._headers()
            self.wfile.write(json.dumps({'ok': True, 'saved': len(roles), 'file': str(OVERRIDES)}).encode())
        except Exception as e:
            self._headers(400)
            self.wfile.write(json.dumps({'ok': False, 'error': str(e)}).encode())
    def log_message(self, fmt, *args):
        print('%s - %s' % (self.address_string(), fmt % args))

if __name__ == '__main__':
    print(f'Staff role API listening on http://127.0.0.1:{PORT}')
    print(f'Saving to {OVERRIDES}')
    HTTPServer(('127.0.0.1', PORT), Handler).serve_forever()

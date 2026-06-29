#!/usr/bin/env python3
"""Generate the Email Intelligence / Source Search page for the Investigations Layer."""
from __future__ import annotations

import html
import json
import re
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

ROOT = Path('/Users/snswcommunications/Hermes-CFO')
VAULT = ROOT / 'email-knowledge'
OUT_DIR = ROOT / 'briefings' / 'dashboards'
SMART = VAULT / '_state' / 'smart_mail_index.sqlite'
ATTACH = VAULT / '_state' / 'attachment_text.sqlite'
MAILBOX = VAULT / '_state' / 'mailbox_index.sqlite'
POLICY_ROOT = ROOT / 'policy-knowledge'
POLICY_DB = POLICY_ROOT / '_state' / 'policy_index.sqlite'


def file_url(path: Path) -> str:
    return 'file://' + quote(str(path))


def q(db: Path, sql: str, params=()):
    conn = sqlite3.connect(db); conn.row_factory = sqlite3.Row
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def scalar(db: Path, sql: str, params=(), default=0):
    rows = q(db, sql, params)
    return rows[0][0] if rows else default


def parse_sender(sender: str) -> tuple[str, str, str]:
    sender = sender or ''
    m = re.search(r'^(.*?)\s*<([^>]+)>', sender)
    if m:
        name = m.group(1).strip().strip('"') or m.group(2).split('@')[0]
        email = m.group(2).lower()
    else:
        m2 = re.search(r'([\w.\-+]+@[\w.\-]+)', sender)
        email = m2.group(1).lower() if m2 else sender.lower().strip()
        name = sender.replace(email, '').strip(' <>') or email.split('@')[0]
    domain = email.split('@')[-1] if '@' in email else 'unknown'
    return name, email, domain


def collect_data() -> dict:
    mail_count = int(scalar(SMART, 'select count(*) from mail'))
    folders = int(scalar(MAILBOX, 'select count(distinct folder) from messages'))
    attach_records = int(scalar(MAILBOX, 'select count(*) from attachments'))
    attach_ok = int(scalar(ATTACH, "select count(*) from extracted_attachments where status='ok'"))
    attach_fail = int(scalar(ATTACH, "select count(*) from extracted_attachments where status='error'"))
    messages_with_attachment_text = int(scalar(SMART, "select value from index_metadata where key='messages_with_attachment_text'", default=0))
    policy_sources = int(scalar(POLICY_DB, "select count(*) from policy_docs where status='ok'", default=0)) if POLICY_DB.exists() else 0
    policy_failures = int(scalar(POLICY_DB, "select count(*) from policy_docs where status='error'", default=0)) if POLICY_DB.exists() else 0
    policy_built_at = scalar(POLICY_DB, "select value from policy_metadata where key='built_at'", default='') if POLICY_DB.exists() else ''
    built_at = scalar(SMART, "select value from index_metadata where key='built_at'", default='')
    date_row = q(SMART, 'select min(received) as first, max(received) as last from mail')[0]
    top_senders = [dict(r) for r in q(SMART, 'select sender,count(*) as count,min(received) as first,max(received) as last from mail group by sender order by count desc limit 12')]
    domain_counter = Counter()
    for r in q(SMART, 'select sender from mail'):
        _, _, dom = parse_sender(r['sender'])
        domain_counter[dom] += 1
    top_domains = [{'domain': d, 'count': c} for d, c in domain_counter.most_common(12)]
    recent_open = []
    open_path = VAULT / '04-open-loops' / 'open-loop-candidates.md'
    if open_path.exists():
        text = open_path.read_text(errors='ignore')
        for block in text.split('\n### ')[1:8]:
            title = block.splitlines()[0]
            note = re.search(r'Local note: `([^`]+)`', block)
            raw = re.search(r'Raw JSON: `([^`]+)`', block)
            recent_open.append({'title': title, 'note': note.group(1) if note else '', 'raw': raw.group(1) if raw else ''})
    topics = []
    topic_readme = VAULT / '07-topics' / 'README.md'
    if topic_readme.exists():
        for line in topic_readme.read_text(errors='ignore').splitlines():
            m = re.match(r'\| \[\[([^|]+)\|([^\]]+)\]\] \| (\d+) \|', line)
            if m:
                topics.append({'path': m.group(1)+'.md', 'title': m.group(2), 'count': int(m.group(3))})
    return {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'built_at': built_at,
        'date_first': date_row['first'],
        'date_last': date_row['last'],
        'mail_count': mail_count,
        'folders': folders,
        'attachment_records': attach_records,
        'attachment_text_ok': attach_ok,
        'attachment_text_failed': attach_fail,
        'messages_with_attachment_text': messages_with_attachment_text,
        'policy_sources': policy_sources,
        'policy_failures': policy_failures,
        'policy_built_at': policy_built_at,
        'top_senders': top_senders,
        'top_domains': top_domains,
        'topics': topics,
        'open_loop_candidates': recent_open,
        'paths': {
            'vault': str(VAULT),
            'smart_index': str(SMART),
            'dashboard_md': str(VAULT / '00-dashboard' / 'Mailbox Intelligence Dashboard.md'),
            'answer_cli': str(ROOT / 'tools' / 'outlook-reader' / 'mail_answer_workflow.py'),
            'lookup_cli': str(ROOT / 'tools' / 'outlook-reader' / 'smart_mail_lookup.py'),
            'policy_root': str(POLICY_ROOT),
            'policy_index': str(POLICY_DB),
            'policy_lookup_cli': str(ROOT / 'tools' / 'outlook-reader' / 'policy_lookup.py'),
            'investigations_layer': str(OUT_DIR / 'constituency-investigations-layer.html'),
            'dashboard_html': str(OUT_DIR / 'email-intelligence-dashboard.html'),
        }
    }


def fmt(n):
    return f"{int(n):,}"


def render(data: dict) -> str:
    def esc(x): return html.escape(str(x or ''))
    def href(path): return esc(file_url(Path(path)))
    def available(path): return Path(path).exists()
    def status(path): return "Available" if available(path) else "Not found"
    cards = [
        ('Emails indexed', fmt(data['mail_count']), 'Full local Outlook archive'),
        ('Attachment text', fmt(data['attachment_text_ok']), f"{fmt(data['messages_with_attachment_text'])} emails covered"),
        ('Policy sources', fmt(data['policy_sources']), 'SPD policy + local guidelines'),
        ('Folders', fmt(data['folders']), 'Mailbox/source folders'),
    ]
    card_html = ''.join(f"<div class='card'><div class='label'>{esc(k)}</div><div class='value'>{v}</div><div class='sub'>{esc(s)}</div></div>" for k,v,s in cards)
    topic_html = ''.join(f"<tr><td>{esc(t['title'])}</td><td>{t['count']}</td><td><code>{esc(t['path'])}</code></td></tr>" for t in data['topics'])
    sender_html = ''.join(f"<tr><td>{esc(r['sender'])}</td><td>{fmt(r['count'])}</td><td>{esc(r['first'])}</td><td>{esc(r['last'])}</td></tr>" for r in data['top_senders'])
    domain_html = ''.join(f"<tr><td>{esc(r['domain'])}</td><td>{fmt(r['count'])}</td></tr>" for r in data['top_domains'])
    open_html = ''.join(f"<li><strong>{esc(o['title'])}</strong><br><code>{esc(o['note'])}</code></li>" for o in data['open_loop_candidates'])
    cmd = "cd /Users/snswcommunications/Hermes-CFO/tools/outlook-reader && source .venv/bin/activate && python mail_answer_workflow.py \"YOUR CFO QUESTION\" --limit 15 --policy-limit 6"
    lookup = "cd /Users/snswcommunications/Hermes-CFO/tools/outlook-reader && source .venv/bin/activate && python smart_mail_lookup.py \"SEARCH TERMS\" --limit 10"
    policy_lookup = "cd /Users/snswcommunications/Hermes-CFO/tools/outlook-reader && source .venv/bin/activate && python policy_lookup.py \"POLICY TERMS\" --limit 10"
    command_rows = [
        ('smart_mail_lookup', 'Fast source search across message bodies and extracted attachment text.', data['paths']['lookup_cli'], lookup),
        ('mail_answer_workflow', 'Natural-language investigation packet with cited email evidence and optional policy evidence.', data['paths']['answer_cli'], cmd),
        ('policy_lookup', 'Policy/guideline source-truth lookup for P-number citations when the policy index is present.', data['paths']['policy_lookup_cli'], policy_lookup),
    ]
    command_html = ''.join(
        f"<article class='command-card'><div><h3>{esc(name)}</h3><p class='muted'>{esc(desc)}</p><p><span class='pill small-pill'>{esc(status(path))}</span> <a href='{href(path)}'>Open script</a></p></div><pre>{esc(command)}</pre></article>"
        for name, desc, path, command in command_rows
    )
    return f"""<!doctype html>
<html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<title>Email Intelligence / Source Search</title>
<style>
:root{{--bg:#f6f9fc;--surface:#fff;--ink:#061b31;--text:#334155;--muted:#64748d;--line:#e5edf5;--purple:#533afd;--green:#0a8f43;--shadow:rgba(50,50,93,.16) 0 24px 60px -34px,rgba(0,0,0,.07) 0 14px 36px -24px;}}
*{{box-sizing:border-box}} body{{margin:0;background:linear-gradient(180deg,#fff 0%,#f7faff 46%,#eef4fb 100%);color:var(--text);font:300 14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}}
header{{padding:34px 36px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:18px;align-items:flex-end;background:rgba(255,255,255,.86);backdrop-filter:blur(18px)}} h1{{margin:8px 0 6px;font-size:44px;line-height:1.02;letter-spacing:-.06em;font-weight:300;color:var(--ink)}} .muted{{color:var(--muted)}} main{{padding:28px 36px;max-width:1440px;margin:0 auto}} .nav{{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}} .grid{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}} .card,.command-card{{background:rgba(255,255,255,.96);border:1px solid var(--line);border-radius:10px;padding:18px;box-shadow:var(--shadow)}} .label{{color:#718098;font-size:12px;text-transform:uppercase;letter-spacing:.11em;font-weight:650}} .value{{font-size:34px;font-weight:300;margin:8px 0;letter-spacing:-.05em;color:var(--ink);font-variant-numeric:tabular-nums}} .sub{{color:var(--muted)}} section{{margin-top:22px;background:rgba(255,255,255,.96);border:1px solid var(--line);border-radius:10px;padding:20px;box-shadow:var(--shadow)}} h2{{margin:0 0 12px;font-size:22px;letter-spacing:-.035em;font-weight:350;color:var(--ink)}} h3{{margin:0 0 4px;color:var(--ink);font-weight:450}} table{{width:100%;border-collapse:collapse}} th,td{{padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top}} th{{text-align:left;color:#718098;font-size:12px;text-transform:uppercase;letter-spacing:.09em;font-weight:650}} code,pre{{background:#f8fbff;color:#273951;border:1px solid var(--line);border-radius:8px}} code{{padding:2px 6px}} pre{{padding:14px;overflow:auto}} .two{{display:grid;grid-template-columns:2fr 1fr;gap:18px}} .commands{{display:grid;gap:14px}} .command-card{{display:grid;grid-template-columns:minmax(240px,.75fr) 1.25fr;gap:16px;align-items:start}} .pill{{display:inline-flex;gap:8px;align-items:center;border:1px solid #d6d9fc;background:#fff;border-radius:999px;padding:6px 10px;color:var(--purple);box-shadow:rgba(23,23,23,.04) 0 2px 8px}} .small-pill{{font-size:12px;padding:4px 8px}} .accent{{color:var(--green)}} li{{margin:0 0 10px}} a{{color:var(--purple);text-decoration:none}} .note{{border-color:#d6d9fc;background:linear-gradient(90deg,#f6f5ff,#fff)}} @media(max-width:900px){{.grid,.two,.command-card{{grid-template-columns:1fr}}header{{display:block}}}}
</style></head>
<body><header><div><div class='pill'>Investigations Layer source-search</div><h1>Email Intelligence / Source Search</h1><div class='muted'>Local-only Outlook archive search across email bodies and extracted PDF/DOCX/XLSX attachment text, designed for exact source citations and claim testing.</div><nav class='nav'><a class='pill' href='constituency-investigations-layer.html'>Investigations Layer</a><a class='pill' href='email-intelligence-dashboard-data.json'>Dashboard JSON</a><a class='pill' href='{href(data['paths']['dashboard_md'])}'>Mailbox dashboard note</a><a class='pill' href='{href(data['paths']['vault'])}'>Email vault</a></nav></div><div class='muted'>Generated {esc(data['generated_at'])}<br>Index built {esc(data['built_at'])}</div></header>
<main>{card_html}
<section class='note'><h2>Investigations Layer role</h2><p>This page is the <strong>Email Intelligence / Source Search</strong> page for the Investigations Layer. Use it to test claims against source emails, recover person/org history, trace approvals, find contradictions, and pair E-number email evidence with P-number policy/source-truth evidence.</p><p class='muted'>Read-only dashboard artifact; it does not alter the source email vault.</p></section>
<section><h2>Source-search commands</h2><p class='muted'>Use the available local CLI tools below from Hermes or Terminal. The lookup tools return cited source packets; the answer workflow is for “what happened with X?” or “find evidence for Y”.</p><div class='commands'>{command_html}</div></section>
<section><h2>Archive coverage</h2><div class='two'><div><table><tr><th>Measure</th><th>Value</th></tr><tr><td>Date range</td><td>{esc(data['date_first'])} → {esc(data['date_last'])}</td></tr><tr><td>Attachment records</td><td>{fmt(data['attachment_records'])}</td></tr><tr><td>Attachment extraction failures</td><td>{fmt(data['attachment_text_failed'])}</td></tr><tr><td>Policy/guideline sources</td><td>{fmt(data['policy_sources'])} indexed; {fmt(data['policy_failures'])} failed</td></tr><tr><td>Policy index built</td><td>{esc(data['policy_built_at'])}</td></tr><tr><td>Vault</td><td><code>{esc(data['paths']['vault'])}</code></td></tr><tr><td>Smart index</td><td><code>{esc(data['paths']['smart_index'])}</code></td></tr><tr><td>Policy index</td><td><code>{esc(data['paths']['policy_index'])}</code></td></tr></table></div><div><h2>Open-loop sample</h2><ul>{open_html}</ul></div></div></section>
<section><h2>Topic maps</h2><table><tr><th>Topic</th><th>Evidence emails</th><th>Map path</th></tr>{topic_html}</table></section>
<section class='two'><div><h2>Top senders</h2><table><tr><th>Sender</th><th>Emails</th><th>First</th><th>Last</th></tr>{sender_html}</table></div><div><h2>Top domains</h2><table><tr><th>Domain</th><th>Emails</th></tr>{domain_html}</table></div></section>
<section><h2>Dashboard integration note</h2><p>This page belongs inside the <strong>Investigations Layer</strong> as the Email / Source Search tool supporting claim-testing, source lookup, person/org history, and contradictions.</p><p class='muted'>Static artifact: <code>/Users/snswcommunications/Hermes-CFO/briefings/dashboards/email-intelligence-dashboard.html</code></p></section>
</main></body></html>"""


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    data = collect_data()
    (OUT_DIR / 'email-intelligence-dashboard-data.json').write_text(json.dumps(data, indent=2), encoding='utf-8')
    (OUT_DIR / 'email-intelligence-dashboard.html').write_text(render(data), encoding='utf-8')
    print(json.dumps({'html': str(OUT_DIR / 'email-intelligence-dashboard.html'), 'data': str(OUT_DIR / 'email-intelligence-dashboard-data.json'), 'emails': data['mail_count'], 'attachment_text_ok': data['attachment_text_ok']}, indent=2))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())

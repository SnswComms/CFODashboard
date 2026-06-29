#!/usr/bin/env python3
"""Build starter evidence registry for CFO dashboards."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/Users/snswcommunications/Hermes-CFO')
OUT = ROOT / 'briefings/dashboards'


def main() -> int:
    generated = datetime.now(timezone.utc).isoformat(timespec='seconds')
    registry = {
        'generated_at': generated,
        'schema': 'evidence-object.schema.json',
        'metrics': [
            {
                'metric_id': 'myob_broad_accounts_count',
                'label': 'MYOB accounts cached',
                'value': 433,
                'unit': 'accounts',
                'period': 'MYOB cache generated 2026-06-20T09:38:53+00:00',
                'basis': 'read-only MYOB Account endpoint row count',
                'confidence': 'high',
                'status': 'source-backed',
                'sources': [{'type': 'dashboard_cache', 'locator': 'finance/myob-cache/morpheus-broad-readonly/morpheus-broad-readonly-cache.json', 'endpoint': 'MYOB Account'}],
                'drilldowns': [{'label': 'Open MYOB broad cache', 'url': 'morpheus-myob-broad-readonly-dashboard.html'}],
            },
            {
                'metric_id': 'myob_broad_journal_sample_count',
                'label': 'MYOB journal transaction sample',
                'value': 750,
                'unit': 'transactions',
                'period': 'Since 2025-07-01 sample cap',
                'basis': 'read-only JournalTransaction endpoint sample via Morpheus',
                'confidence': 'medium',
                'status': 'source-backed',
                'sources': [{'type': 'dashboard_cache', 'locator': 'finance/myob-cache/morpheus-broad-readonly/morpheus-broad-readonly-cache.json', 'endpoint': 'MYOB JournalTransaction?$expand=Details'}],
                'drilldowns': [{'label': 'Open MYOB account drilldown', 'url': 'myob-account-drilldown-dashboard.html'}],
                'notes': 'Sample-capped; not a complete P&L or trial balance.',
            },
            {
                'metric_id': 'myob_312510_balance',
                'label': 'MYOB account 312510 balance',
                'value': -35571.52,
                'unit': 'AUD',
                'period': 'As of 2026-06-20',
                'basis': 'Benefits tracker account summary via Morpheus',
                'account': '312510',
                'confidence': 'high',
                'status': 'source-backed',
                'sources': [{'type': 'dashboard_cache', 'locator': 'finance/myob-cache/morpheus-benefits-312510/morpheus-benefits-312510-cache.json', 'endpoint': 'GET /api/summary/full'}],
                'drilldowns': [{'label': 'Open Morpheus MYOB 312510', 'url': 'morpheus-myob-312510-dashboard.html'}],
            },
            {
                'metric_id': 'local_church_evangelism_account',
                'label': 'Local church evangelism account activity',
                'value': 0,
                'unit': 'AUD',
                'period': 'Current MYOB sample since 2025-07-01',
                'basis': 'Account-specific drilldown for MYOB account 703430',
                'account': '703430',
                'confidence': 'medium',
                'status': 'source-backed',
                'sources': [{'type': 'dashboard_cache', 'locator': 'finance/myob-cache/account-drilldowns/myob-account-703430-drilldown.json'}],
                'drilldowns': [{'label': 'Open MYOB account drilldown', 'url': 'myob-account-drilldown-dashboard.html'}],
                'notes': 'Returned zero current MYOB bill/journal lines for 703430; if dashboard shows evangelism overspend, it likely uses another account/subaccount/source or SUN/Excel data.',
            },
        ],
    }
    (OUT / 'evidence-registry-starter.json').write_text(json.dumps(registry, indent=2), encoding='utf-8')
    print(OUT / 'evidence-registry-starter.json')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())

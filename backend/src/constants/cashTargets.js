// Ported from src/snsw_cfo_dashboard/generate_cash_position_dashboard.py.
// Governance: screenshot Westpac/CMF balances are reconciliation targets only,
// never dashboard actuals. Balances come exclusively from MYOB API/cache.
// External account identifiers are stored pre-masked (last 4 digits only).

const SOURCE_RULE =
  "MYOB API/cache only for actual balances; screenshot account numbers are reconciliation targets only.";

const SOURCE_STATUS_NOT_REFRESHED = "MYOB cash endpoints not yet refreshed";
const CMF_STATUS_NOT_REFRESHED = "MYOB CMF cash extractor not yet refreshed";
const TARGET_STATUS_AWAITING = "awaiting MYOB endpoint match";

// 12 Westpac reconciliation targets (account identifiers masked to last 4).
const WESTPAC_TARGETS = [
  { system: "Westpac", name: "Narromine", external_account: "•••• 5114" },
  { system: "Westpac", name: "Canberra CS", external_account: "•••• 2830" },
  { system: "Westpac", name: "SNU", external_account: "•••• 0024" },
  { system: "Westpac", name: "SNSW Education", external_account: "•••• 3567" },
  { system: "Westpac", name: "SNC - Conference", external_account: "•••• 3575" },
  { system: "Westpac", name: "AAV", external_account: "•••• 6300" },
  { system: "Westpac", name: "ELC", external_account: "•••• 3635" },
  { system: "Westpac", name: "AdventistMerch.com", external_account: "•••• 6639" },
  { system: "Westpac", name: "Wodonga Op Shop", external_account: "•••• 8458" },
  { system: "Westpac", name: "Fyshwick Op Shop", external_account: "•••• 8466" },
  { system: "Westpac", name: "Op Shop 3", external_account: "•••• 8474" },
  { system: "Westpac", name: "Border CS", external_account: "•••• 3070" },
];

// 8 CMF member-account reconciliation targets (masked to last 4).
const CMF_TARGETS = [
  { system: "CMF", name: "ADVENTIST ALPINE VILLAGE", external_account: "•••• 2800" },
  { system: "CMF", name: "SDA CHURCH (SNSW) LTD", external_account: "•••• 3200" },
  { system: "CMF", name: "SNSW SDA SS BLDG & MAINT FUND", external_account: "•••• 7500" },
  { system: "CMF", name: "SOUTH N.S.W. CONFERENCE", external_account: "•••• 3000" },
  { system: "CMF", name: "STH NSW CONF - ADCARE", external_account: "•••• 3400" },
  { system: "CMF", name: "STH.NSW CONF.EDUC.BLDG & MAINT", external_account: "•••• 0000" },
  { system: "CMF", name: "STH.NSW CONF.RESOURCE", external_account: "•••• 0700" },
  { system: "CMF", name: "STH.NSW SCHOOLS-LIBRARY FUND", external_account: "•••• 9600" },
];

// Recommended MYOB GL cash accounts (chart-of-accounts constants).
const RECOMMENDED_MYOB_ACCOUNTS = [
  { AccountCD: "111200", Description: "Bank account (AUD)" },
  { AccountCD: "111300", Description: "Cash Management Facility (AUD)" },
  { AccountCD: "111100", Description: "Cash on hand" },
  { AccountCD: "111400", Description: "Cash held for agency" },
  { AccountCD: "111500", Description: "Term deposits" },
];

module.exports = {
  SOURCE_RULE,
  SOURCE_STATUS_NOT_REFRESHED,
  CMF_STATUS_NOT_REFRESHED,
  TARGET_STATUS_AWAITING,
  WESTPAC_TARGETS,
  CMF_TARGETS,
  RECOMMENDED_MYOB_ACCOUNTS,
};

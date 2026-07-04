/**
 * Branded transactional email templates for the CFO Dashboard.
 *
 * Every render function returns { subject, html, text }. Signatures are FROZEN
 * (see AUTH-CONTRACT section 4):
 *   renderVerificationEmail({ name, url })
 *   renderPasswordResetEmail({ name, url })
 *   renderWelcomeEmail({ name, url, invitedBy })
 *   renderPasswordChangedEmail({ name })
 *   renderAccountStatusEmail({ name, banned, reason })
 *
 * HTML is table-based, 600px, inline styles only (email-client safe).
 */

const FONT = "'Poppins', 'Segoe UI', Arial, sans-serif";
const INK = "#1B2430";
const CREAM = "#FAFAF8";
const GOLD = "#C9A24B";
const BORDER = "#E7E5DF";
const MUTED = "#757C86";
const FAINT = "#9AA0A8";
const GOOD = "#3E7A55";
const BAD = "#A8443B";
const BTN_TEXT = "#FBFBF9";

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function greetingName(name) {
  const trimmed = String(name || "").trim();
  return trimmed || "there";
}

/** Bulletproof CTA button: ink background, near-white text, 9px radius. */
function button(url, label) {
  return `
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:28px 0 0 0;">
              <tr>
                <td align="center" bgcolor="${INK}" style="border-radius:9px;">
                  <a href="${esc(url)}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:14px;font-weight:600;line-height:20px;color:${BTN_TEXT};text-decoration:none;border-radius:9px;background-color:${INK};">${esc(label)}</a>
                </td>
              </tr>
            </table>`;
}

/** Fallback raw link printed under the button for copy-paste. */
function rawLink(url) {
  return `
            <p style="margin:14px 0 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${FAINT};word-break:break-all;">If the button does not work, copy and paste this link into your browser:<br /><a href="${esc(url)}" target="_blank" style="color:${FAINT};text-decoration:underline;">${esc(url)}</a></p>`;
}

/**
 * Shared branded layout.
 * opts: { title, preheader, accent?, bodyHtml, expires? (boolean) }
 */
function layout({ title, preheader, accent = GOLD, bodyHtml, expires = false }) {
  const expiryLine = expires
    ? `<p style="margin:0 0 6px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${FAINT};">This link expires in 60 minutes.</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${CREAM};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(preheader)}</div>
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${CREAM}" style="background-color:${CREAM};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;">
          <!-- Header / wordmark -->
          <tr>
            <td style="padding:0 8px 18px 8px;">
              <span style="font-family:${FONT};font-size:17px;font-weight:600;letter-spacing:0.3px;color:${INK};">CFO Command Centre</span>
              <span style="font-family:${FONT};font-size:17px;font-weight:700;color:${GOLD};">&#8226;</span>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid ${BORDER};border-radius:12px;padding:32px;">
              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:0 0 20px 0;">
                    <div style="width:36px;height:3px;background-color:${accent};border-radius:2px;font-size:0;line-height:0;">&nbsp;</div>
                  </td>
                </tr>
                <tr>
                  <td>
${bodyHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 8px 0 8px;" align="center">
              ${expiryLine}
              <p style="margin:0 0 6px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${FAINT};">South NSW Conference &#183; local finance workspace</p>
              <p style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${FAINT};">You received this email because an administrator manages your CFO Dashboard account.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function heading(textContent) {
  return `<h1 style="margin:0 0 12px 0;font-family:${FONT};font-size:20px;font-weight:600;line-height:28px;color:${INK};">${esc(textContent)}</h1>`;
}

function para(html) {
  return `<p style="margin:0 0 8px 0;font-family:${FONT};font-size:14px;line-height:22px;color:${INK};">${html}</p>`;
}

function mutedPara(html) {
  return `<p style="margin:8px 0 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${MUTED};">${html}</p>`;
}

function fmtCurrency(value) {
  const n = Math.round(Math.abs(Number(value) || 0)).toLocaleString("en-AU");
  return Number(value) < 0 ? `($${n})` : `$${n}`;
}

function fmtPct(value) {
  return value === null || value === undefined ? "n/a" : `${Number(value).toFixed(1)}%`;
}

function metricCell(label, value, note, color = INK) {
  return `
                  <td width="50%" style="padding:10px;border:1px solid ${BORDER};border-radius:8px;">
                    <div style="font-family:${FONT};font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${FAINT};">${esc(label)}</div>
                    <div style="margin-top:8px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:600;color:${INK};">${esc(value)}</div>
                    <div style="margin-top:3px;font-family:${FONT};font-size:12px;line-height:18px;color:${color};">${esc(note)}</div>
                  </td>`;
}

function monthlyRows(church) {
  return (church.monthly || [])
    .map((row) => {
      const current = Number(row.current) || 0;
      const prior = Number(row.prior) || 0;
      const delta = current && prior ? ((current - prior) / prior) * 100 : null;
      return `
                    <tr>
                      <td style="padding:7px 0;border-bottom:1px solid ${BORDER};font-family:${FONT};font-size:12px;color:${INK};">${esc(row.month)}</td>
                      <td align="right" style="padding:7px 0;border-bottom:1px solid ${BORDER};font-family:${FONT};font-size:12px;color:${INK};">${current ? esc(fmtCurrency(current)) : "&#8212;"}</td>
                      <td align="right" style="padding:7px 0;border-bottom:1px solid ${BORDER};font-family:${FONT};font-size:12px;color:${MUTED};">${esc(fmtCurrency(prior))}</td>
                      <td align="right" style="padding:7px 0;border-bottom:1px solid ${BORDER};font-family:${FONT};font-size:12px;color:${delta === null ? FAINT : delta >= 0 ? GOOD : BAD};">${delta === null ? "&#8212;" : esc(fmtPct(delta))}</td>
                    </tr>`;
    })
    .join("\n");
}

const TEXT_FOOTER =
  "South NSW Conference · local finance workspace\n" +
  "You received this email because an administrator manages your CFO Dashboard account.";

function textBody(lines) {
  return lines.filter((l) => l !== null && l !== undefined).join("\n") + "\n\n--\n" + TEXT_FOOTER + "\n";
}

// ---------------------------------------------------------------------------

function renderVerificationEmail({ name, url }) {
  const subject = "Confirm your email — CFO Dashboard";
  const who = greetingName(name);
  const html = layout({
    title: subject,
    preheader: "Confirm your email address to activate your CFO Dashboard access.",
    accent: GOLD,
    expires: true,
    bodyHtml: [
      heading("Confirm your email"),
      para(`Hi ${esc(who)},`),
      para(
        "Please confirm this email address so we know it belongs to you. Once confirmed, your CFO Dashboard account is ready to use."
      ),
      button(url, "Confirm email"),
      rawLink(url),
      mutedPara("If you weren't expecting this email, you can safely ignore it."),
    ].join("\n"),
  });
  const text = textBody([
    `Hi ${who},`,
    "",
    "Please confirm this email address so we know it belongs to you. Once confirmed, your CFO Dashboard account is ready to use.",
    "",
    `Confirm your email: ${url}`,
    "",
    "This link expires in 60 minutes.",
    "If you weren't expecting this email, you can safely ignore it.",
  ]);
  return { subject, html, text };
}

function renderPasswordResetEmail({ name, url }) {
  const subject = "Reset your password — CFO Dashboard";
  const who = greetingName(name);
  const html = layout({
    title: subject,
    preheader: "Use this link to set a new password for your CFO Dashboard account.",
    accent: GOLD,
    expires: true,
    bodyHtml: [
      heading("Reset your password"),
      para(`Hi ${esc(who)},`),
      para(
        "We received a request to reset the password for your CFO Dashboard account. Use the button below to choose a new one. The link expires in 60 minutes."
      ),
      button(url, "Reset password"),
      rawLink(url),
      mutedPara("If you didn't request this, no action is needed — your password will stay the same."),
    ].join("\n"),
  });
  const text = textBody([
    `Hi ${who},`,
    "",
    "We received a request to reset the password for your CFO Dashboard account. Use the link below to choose a new one. The link expires in 60 minutes.",
    "",
    `Reset your password: ${url}`,
    "",
    "If you didn't request this, no action is needed — your password will stay the same.",
  ]);
  return { subject, html, text };
}

function renderWelcomeEmail({ name, url, invitedBy }) {
  const subject = "Welcome to CFO Dashboard";
  const who = greetingName(name);
  const inviter = String(invitedBy || "").trim();
  const invitedHtml = inviter
    ? para(`${esc(inviter)} has set up an account for you on the CFO Dashboard — the South NSW Conference local finance workspace.`)
    : para("An administrator has set up an account for you on the CFO Dashboard — the South NSW Conference local finance workspace.");
  const invitedText = inviter
    ? `${inviter} has set up an account for you on the CFO Dashboard — the South NSW Conference local finance workspace.`
    : "An administrator has set up an account for you on the CFO Dashboard — the South NSW Conference local finance workspace.";
  const html = layout({
    title: subject,
    preheader: "Your CFO Dashboard account is ready — set your password to get started.",
    accent: GOLD,
    expires: true,
    bodyHtml: [
      heading("Welcome to the CFO Dashboard"),
      para(`Hi ${esc(who)},`),
      invitedHtml,
      para("To get started, set your password using the button below. The link expires in 60 minutes."),
      button(url, "Set your password"),
      rawLink(url),
      mutedPara("You'll also receive a separate email asking you to confirm this address."),
    ].join("\n"),
  });
  const text = textBody([
    `Hi ${who},`,
    "",
    invitedText,
    "",
    "To get started, set your password using the link below. The link expires in 60 minutes.",
    "",
    `Set your password: ${url}`,
    "",
    "You'll also receive a separate email asking you to confirm this address.",
  ]);
  return { subject, html, text };
}

function renderPasswordChangedEmail({ name }) {
  const subject = "Your password was changed — CFO Dashboard";
  const who = greetingName(name);
  const html = layout({
    title: subject,
    preheader: "The password for your CFO Dashboard account was just changed.",
    accent: GOLD,
    expires: false,
    bodyHtml: [
      heading("Your password was changed"),
      para(`Hi ${esc(who)},`),
      para("This is a confirmation that the password for your CFO Dashboard account was just changed."),
      mutedPara(
        "If this was you, no further action is needed. If you did not make this change, contact your administrator immediately so they can secure your account."
      ),
    ].join("\n"),
  });
  const text = textBody([
    `Hi ${who},`,
    "",
    "This is a confirmation that the password for your CFO Dashboard account was just changed.",
    "",
    "If this was you, no further action is needed. If you did not make this change, contact your administrator immediately so they can secure your account.",
  ]);
  return { subject, html, text };
}

function renderAccountStatusEmail({ name, banned, reason }) {
  const who = greetingName(name);
  const why = String(reason || "").trim();
  const subject = banned
    ? "Your account has been suspended — CFO Dashboard"
    : "Your account has been reinstated — CFO Dashboard";
  const accent = banned ? BAD : GOOD;
  const bodyParas = banned
    ? [
        heading("Account suspended"),
        para(`Hi ${esc(who)},`),
        para("An administrator has suspended your CFO Dashboard account. You will not be able to sign in while the suspension is in place."),
        why ? para(`Reason: ${esc(why)}`) : "",
        mutedPara("If you believe this is a mistake, contact your administrator."),
      ]
    : [
        heading("Account reinstated"),
        para(`Hi ${esc(who)},`),
        para("Good news — an administrator has reinstated your CFO Dashboard account. You can sign in again as usual."),
        why ? para(`Note: ${esc(why)}`) : "",
        mutedPara("If you have trouble signing in, contact your administrator."),
      ];
  const html = layout({
    title: subject,
    preheader: banned
      ? "Your CFO Dashboard account has been suspended by an administrator."
      : "Your CFO Dashboard account has been reinstated by an administrator.",
    accent,
    expires: false,
    bodyHtml: bodyParas.filter(Boolean).join("\n"),
  });
  const text = textBody(
    banned
      ? [
          `Hi ${who},`,
          "",
          "An administrator has suspended your CFO Dashboard account. You will not be able to sign in while the suspension is in place.",
          why ? `Reason: ${why}` : null,
          "",
          "If you believe this is a mistake, contact your administrator.",
        ]
      : [
          `Hi ${who},`,
          "",
          "Good news — an administrator has reinstated your CFO Dashboard account. You can sign in again as usual.",
          why ? `Note: ${why}` : null,
          "",
          "If you have trouble signing in, contact your administrator.",
        ]
  );
  return { subject, html, text };
}

function renderTitheOnePagerEmail({ church, conference }) {
  const metrics = church.metrics || {};
  const subject = `${church.name} tithe faithfulness — ${conference.as_of || "monthly update"}`;
  const yoyColor = Number(metrics.yoy_delta) >= 0 ? GOOD : BAD;
  const html = layout({
    title: subject,
    preheader: `${church.name} tithe giving, year-over-year tracking and conference contribution share.`,
    accent: GOLD,
    expires: false,
    bodyHtml: [
      heading(`${esc(church.name)} tithe faithfulness`),
      para(`Monthly transparency update for ${esc(conference.as_of || "the current reporting period")}.`),
      `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:20px 0 12px 0;">
                <tr>
${metricCell("Local tithe · YTD", fmtCurrency(metrics.current_ytd), `${fmtCurrency(metrics.yoy_delta)} vs last year`, yoyColor)}
                  <td width="12" style="font-size:0;line-height:0;">&nbsp;</td>
${metricCell("Conference share", fmtPct(metrics.conference_share_pct), "of conference tithe YTD", GOLD)}
                </tr>
                <tr><td colspan="3" height="12" style="font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr>
${metricCell("Year-over-year", fmtPct(metrics.yoy_pct), `${metrics.months_reported || 0} months reported`, yoyColor)}
                  <td width="12" style="font-size:0;line-height:0;">&nbsp;</td>
${metricCell("Projected full year", fmtCurrency(metrics.projected_full_year), `${fmtPct(metrics.projected_vs_prior_pct)} vs prior year`, Number(metrics.projected_vs_prior_pct) >= 0 ? GOOD : BAD)}
                </tr>
              </table>`,
      `<h2 style="margin:20px 0 8px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${INK};">Month by month</h2>
              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <th align="left" style="padding:0 0 8px 0;font-family:${FONT};font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${FAINT};">Month</th>
                  <th align="right" style="padding:0 0 8px 0;font-family:${FONT};font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${FAINT};">This year</th>
                  <th align="right" style="padding:0 0 8px 0;font-family:${FONT};font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${FAINT};">Last year</th>
                  <th align="right" style="padding:0 0 8px 0;font-family:${FONT};font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${FAINT};">YoY</th>
                </tr>
${monthlyRows(church)}
              </table>`,
      mutedPara(
        `${esc(church.name)} represents ${esc(fmtPct(metrics.conference_share_pct))} of ${esc(conference.name || "the conference")} tithe received year-to-date. ${esc(conference.churches_reporting || 0)} of ${esc(conference.churches_total || 0)} churches have reported for this cycle.`
      ),
      mutedPara("Figures are draft until month-end close and treasury reconciliation are complete."),
    ].join("\n"),
  });
  const text = textBody([
    `${church.name} tithe faithfulness — ${conference.as_of || "monthly update"}`,
    "",
    `Local tithe YTD: ${fmtCurrency(metrics.current_ytd)} (${fmtCurrency(metrics.yoy_delta)} vs last year)`,
    `Year-over-year: ${fmtPct(metrics.yoy_pct)}`,
    `Conference share: ${fmtPct(metrics.conference_share_pct)} of conference tithe YTD`,
    `Projected full year: ${fmtCurrency(metrics.projected_full_year)} (${fmtPct(metrics.projected_vs_prior_pct)} vs prior year)`,
    "",
    "Month by month:",
    ...((church.monthly || []).map((row) => {
      const current = Number(row.current) || 0;
      const prior = Number(row.prior) || 0;
      const delta = current && prior ? ((current - prior) / prior) * 100 : null;
      return `${row.month}: ${current ? fmtCurrency(current) : "-"} this year / ${fmtCurrency(prior)} last year / ${fmtPct(delta)} YoY`;
    })),
    "",
    `${church.name} represents ${fmtPct(metrics.conference_share_pct)} of ${conference.name || "the conference"} tithe received year-to-date.`,
    "Figures are draft until month-end close and treasury reconciliation are complete.",
  ]);
  return { subject, html, text };
}

module.exports = {
  renderVerificationEmail,
  renderPasswordResetEmail,
  renderWelcomeEmail,
  renderPasswordChangedEmail,
  renderAccountStatusEmail,
  renderTitheOnePagerEmail,
};

#!/usr/bin/env node

const { triggerMonthlyEmailBatch } = require("../src/services/titheService");

function parseArgs(argv) {
  const args = {
    previewOnly: true,
    churchIds: [],
    testTo: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--send") args.previewOnly = false;
    else if (arg === "--preview") args.previewOnly = true;
    else if (arg === "--church") args.churchIds.push(argv[(i += 1)]);
    else if (arg === "--test-to") args.testTo = argv[(i += 1)];
    else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: node scripts/send-tithe-monthly-emails.js [options]",
          "",
          "Options:",
          "  --preview          Render batch without sending (default)",
          "  --send             Send through the configured mailer",
          "  --church <id>      Limit to one church id; repeatable",
          "  --test-to <email>  Send/preview every selected church to one test address",
        ].join("\n")
      );
      process.exit(0);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await triggerMonthlyEmailBatch(args);
  console.log(
    JSON.stringify(
      {
        count: result.data.count,
        preview_only: result.data.preview_only,
        mail_status: result.data.mail_status,
        results: result.data.results.map((row) => ({
          church_id: row.church_id,
          church_name: row.church_name,
          to: row.to,
          subject: row.subject,
          send_result: row.send_result,
        })),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

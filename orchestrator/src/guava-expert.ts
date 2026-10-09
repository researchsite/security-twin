import * as guava from "@guava-ai/guava-sdk";

// Subprocess script: places one outbound Guava call, writes {"outcome","approved"} JSON to stdout,
// then exits.  Spawned by stages/alert.ts via ts-node.
//
// Env vars consumed (all required — caller validates before spawn):
//   GUAVA_API_KEY, GUAVA_AGENT_NUMBER, ALERT_TO, ALERT_TEXT, ALERT_IMPACT, ALERT_PR_URL

const toNumber    = process.env.ALERT_TO      ?? "";
const alertText   = process.env.ALERT_TEXT    ?? "A security vulnerability was confirmed.";
const alertImpact = process.env.ALERT_IMPACT  ?? "Unauthorized cross-user data access is possible.";
const prUrl       = process.env.ALERT_PR_URL  ?? "";

let resultWritten = false;

function writeResult(outcome: string, approved: boolean | null): void {
  if (resultWritten) return;
  resultWritten = true;
  process.stdout.write(JSON.stringify({ outcome, approved }) + "\n");
}

// Fast-exit if called without required env (belt-and-suspenders; alert.ts already checks)
if (!toNumber || !process.env.GUAVA_API_KEY || !process.env.GUAVA_AGENT_NUMBER) {
  writeResult("skipped", null);
  process.exit(0);
}

const agent = new guava.Agent({
  name: "Security Twin Alert",
  organization: "Security Team",
  purpose:
    "Deliver a security incident alert to the on-call engineer and collect a yes/no decision " +
    "about merging the automated fix pull request.",
});

agent.onCallStart(async (call: guava.Call) => {
  const prLine = prUrl
    ? `A fix pull request is ready at: ${prUrl}`
    : "An automated fix has been prepared and verified.";

  await call.setTask({
    taskId: "security_alert",
    objective:
      "You are calling the on-call security engineer to report a confirmed vulnerability. " +
      "Be brief, professional, and to the point. " +
      "State the finding, the impact, then ask for their approval decision.",
    checklist: [
      `Say: "Security alert from the automated red-team system. ` +
      `${alertText} ` +
      `Impact: ${alertImpact} ` +
      `${prLine}."`,
      guava.Field({
        key: "approval",
        fieldType: "multiple_choice",
        choices: ["yes", "no"],
        description: "Ask: Do you approve merging the automated fix? Please say yes or no.",
      }),
      "Confirm their answer, thank them, and end the call.",
    ],
  });
});

agent.onTaskComplete("security_alert", async (call: guava.Call) => {
  const approval = await call.getField("approval");
  writeResult(approval === "yes" ? "approved" : "rejected", approval === "yes");
  await call.hangup("Thank you. Your decision has been recorded. Goodbye.");
});

agent.onOutboundFailed(async () => {
  writeResult("no_answer", null);
  process.exit(0);
});

agent.onSessionEnd(async (_call: guava.Call) => {
  // Fallback: session ended before the task completed (caller hung up early)
  writeResult("no_decision", null);
  process.exit(0);
});

agent.callPhone(process.env.GUAVA_AGENT_NUMBER!, toNumber);

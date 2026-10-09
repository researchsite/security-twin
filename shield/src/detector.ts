export interface DetectionResult {
  blocked: boolean;
  category?: string;
}

const PATTERNS: Array<{ category: string; re: RegExp }> = [
  { category: "sql_injection", re: /('|--|;|\bUNION\b|\bSELECT\b|\bDROP\b|\bINSERT\b|\bDELETE\b|\bOR\b\s+['"\d])/i },
  { category: "xss", re: /<script|javascript:|on\w+\s*=|<iframe|<svg|alert\s*\(/i },
  { category: "path_traversal", re: /\.\.[/\\]|%2e%2e[/\\%]/i },
  { category: "command_injection", re: /[;&|`$]|\$\(|`[^`]+`|\bexec\b|\beval\b|\bsystem\b/i },
  { category: "ssrf", re: /169\.254\.169\.254|localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0/i },
];

export function detectAttack(raw: string, path: string, method: string): DetectionResult {
  for (const { category, re } of PATTERNS) {
    if (re.test(raw)) {
      return { blocked: true, category };
    }
  }
  return { blocked: false };
}

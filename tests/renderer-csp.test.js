import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const root = process.cwd();
const ENTRY_POINTS = ["index.html", "pet-overlay.html"];

function readCsp(html) {
  const match = html.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/?>/i,
  );
  return match ? match[1] : null;
}

function directive(policy, name) {
  const found = policy.split(";").find((part) => part.trim().startsWith(`${name} `));
  return found ? found.trim() : null;
}

describe("renderer entry points carry a Content-Security-Policy", () => {
  it.each(ENTRY_POINTS)("%s declares a CSP meta tag", (file) => {
    const policy = readCsp(readFileSync(path.join(root, file), "utf8"));
    expect(policy, `${file} must declare a CSP`).not.toBeNull();
    expect(policy).toContain("default-src 'self'");
  });

  it.each(ENTRY_POINTS)("%s does not allow eval or a wildcard", (file) => {
    const policy = readCsp(readFileSync(path.join(root, file), "utf8"));
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toMatch(/;\s*\*| \*\s/);
  });

  it.each(ENTRY_POINTS)("%s locks down object-src and base-uri", (file) => {
    const policy = readCsp(readFileSync(path.join(root, file), "utf8"));
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
    expect(directive(policy, "base-uri")).toBe("base-uri 'none'");
  });

  it("index.html allows only the beru scheme for media and local images", () => {
    const policy = readCsp(readFileSync(path.join(root, "index.html"), "utf8"));
    expect(directive(policy, "media-src")).toContain("beru:");
    expect(directive(policy, "img-src")).toContain("beru:");
  });

  it("index.html keeps the font and Supabase exceptions it needs", () => {
    const policy = readCsp(readFileSync(path.join(root, "index.html"), "utf8"));
    expect(directive(policy, "style-src")).toContain("'unsafe-inline'");
    expect(directive(policy, "style-src")).toContain("https://fonts.googleapis.com");
    expect(directive(policy, "font-src")).toContain("https://fonts.gstatic.com");
    expect(directive(policy, "connect-src")).toContain("https://*.supabase.co");
    expect(directive(policy, "connect-src")).toContain("wss://*.supabase.co");
  });

  it("pet overlay does not grant the remote font or Supabase origins", () => {
    const policy = readCsp(readFileSync(path.join(root, "pet-overlay.html"), "utf8"));
    expect(policy).not.toContain("fonts.googleapis.com");
    expect(policy).not.toContain("supabase.co");
    expect(directive(policy, "img-src")).toContain("beru:");
  });
});

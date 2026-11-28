import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { releaseNotes } from "./release-notes.mjs";

const changelog = `# Changelog

## [Unreleased]

## [1.1.0] - 2026-12-01

### Ajouté

- **Thing** : a long line that the editor
  wrapped on two lines.
  - Nested detail.

### Supprimé

- Old button.

## [1.0.0] - 2026-11-01

### Ajouté

- First.

[Unreleased]: https://example.com/compare/v1.1.0...HEAD
[1.1.0]: https://example.com/compare/v1.0.0...v1.1.0
[1.0.0]: https://example.com/releases/tag/v1.0.0
`;

describe("releaseNotes", () => {
  it("extracts one version, joins wrapped lines and adds the footer", () => {
    expect(releaseNotes(changelog, "1.1.0")).toBe(
      [
        "## Ajouté",
        "",
        "- **Thing** : a long line that the editor wrapped on two lines.",
        "  - Nested detail.",
        "",
        "## Supprimé",
        "",
        "- Old button.",
        "",
        "---",
        "",
        "Publiée le 2026-12-01 · [Comparer avec la version précédente](https://example.com/compare/v1.0.0...v1.1.0)",
        ""
      ].join("\n")
    );
  });

  it("stops at the link list for the oldest version", () => {
    expect(releaseNotes(changelog, "1.0.0")).toBe(
      "## Ajouté\n\n- First.\n\n---\n\nPubliée le 2026-11-01 · [Voir le code de cette version](https://example.com/releases/tag/v1.0.0)\n"
    );
  });

  it("returns null for a missing or empty version", () => {
    expect(releaseNotes(changelog, "9.9.9")).toBeNull();
    expect(releaseNotes(changelog, "Unreleased")).toBeNull();
  });

  it("has a section for the current package.json version", () => {
    const { version } = JSON.parse(readFileSync("package.json", "utf8"));
    expect(releaseNotes(readFileSync("CHANGELOG.md", "utf8"), version)).not.toBeNull();
  });
});

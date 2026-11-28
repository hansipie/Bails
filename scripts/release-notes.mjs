#!/usr/bin/env node
// Prints the GitHub release description of one version, taken from CHANGELOG.md
// (Keep a Changelog format). Used by .github/workflows/release.yml.
//
//   node scripts/release-notes.mjs CHANGELOG.md 0.3.0 > release-notes.md
//
// Wrapped lines are joined, since GitHub renders single newlines as line breaks, and section
// titles move up one level. Exits with an error when the version has no section.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function releaseNotes(changelog, version) {
  const text = changelog.replace(/\r\n/g, "\n");
  const heading = new RegExp(`^## \\[${escape(version)}\\](?: - (\\S+))?[^\\n]*\\n`, "m");
  const match = heading.exec(text);
  if (!match) return null;

  const rest = text.slice(match.index + match[0].length);
  const end = rest.search(/^(## |\[[^\]]+\]: )/m);
  const body = (end === -1 ? rest : rest.slice(0, end)).trim();
  if (!body) return null;

  const lines = [];
  for (const line of body.split("\n")) {
    const isItem = /^\s*- /.test(line);
    const previous = lines[lines.length - 1];
    if (line.startsWith("  ") && !isItem && previous && previous.trim()) {
      lines[lines.length - 1] = `${previous} ${line.trim()}`;
    } else {
      lines.push(line.startsWith("### ") ? line.slice(1) : line);
    }
  }

  const link = new RegExp(`^\\[${escape(version)}\\]: (\\S+)$`, "m").exec(text)?.[1];
  const footer = [match[1] ? `Publiée le ${match[1]}` : null,
    link ? `[${link.includes("/compare/") ? "Comparer avec la version précédente" : "Voir le code de cette version"}](${link})` : null]
    .filter(Boolean)
    .join(" · ");
  return `${lines.join("\n")}\n${footer ? `\n---\n\n${footer}\n` : ""}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [file, rawVersion] = process.argv.slice(2);
  if (!file || !rawVersion) {
    console.error("usage: release-notes.mjs <CHANGELOG.md> <version>");
    process.exit(2);
  }
  const version = rawVersion.replace(/^v/, "");
  const notes = releaseNotes(readFileSync(file, "utf8"), version);
  if (notes === null) {
    console.error(`No "## [${version}]" section with content in ${file}.`);
    process.exit(1);
  }
  process.stdout.write(notes);
}

/**
 * THE ONE COMMENT-STRIPPER. Guards scan CODE, not prose.
 *
 * `guards-scan-code-not-prose` (PROJECT_INVARIANTS.md:245) — three guards have failed on
 * their own explanatory comments, which pressures the next person to delete the reasoning to
 * keep the suite green. That is the guard destroying the thing it exists to protect.
 *
 * WHY THIS FILE EXISTS: the idiom had drifted to SIX copies in two semantic variants —
 * scripts/status-write-guard.ts, scripts/test-isolation-guard.ts (regex form),
 * scripts/live-badge-guard.ts, scripts/preview-bypass-guard.ts, scripts/fair-open-gate-guard.ts
 * (line-filter form), and an unnamed inline copy in scripts/organizer-ghost-guard.ts. Two
 * copies of one derivation is this codebase's central bug class; six is that class with a
 * running start.
 *
 * THE VARIANT CHOSEN, and why it is not arbitrary: the line-filter form
 * (`.split('\n').filter(...).join('\n')`) DELETES comment lines, which shifts every character
 * offset and line number after them. Guards that report a position (organizer-ghost-guard
 * prints `@ char N`) would report coordinates that do not exist in the real file. The regex
 * form BLANKS the comment and keeps the line, so offsets and line numbers survive the strip.
 * Position-preserving wins.
 *
 * KNOWN LIMITS, stated rather than discovered later:
 *   - A trailing `code() // note` comment is NOT stripped (only whole-line `//`).
 *   - A `//` or block-comment sequence inside a string literal IS stripped. No guard in this
 *     repo scans for such a shape; if one ever does, it needs a real parser, not this.
 */

/** Remove block comments and whole-line `//` comments, preserving line count and offsets. */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')) // keep newlines AND width
    .replace(/^(\s*)\/\/.*$/gm, '$1')
}

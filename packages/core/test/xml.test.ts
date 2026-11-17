import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flattenTree, parseLogbook, parseXml, serializeLogbook, serializeXml, type GitTree, type Logbook } from '../src/index.ts';
import { sampleRepo } from './fixtures/sample-repo.ts';
import { describeDifferences, readGitTree, treeFromObject } from './helpers/git-tree.ts';

/** Git files without the filter presets, which XML export does not carry. */
function comparable(tree: GitTree): Map<string, string> {
  return new Map([...flattenTree(tree)].filter(([path]) => !path.startsWith('02-Filterpresets')));
}

describe('Subsurface XML', () => {
  const { logbook } = parseLogbook(treeFromObject(sampleRepo));

  it('survives git → XML → git without changes', () => {
    const xml = serializeXml(logbook);
    const back = parseXml(xml);
    expect(back.warnings).toEqual([]);
    const before = comparable(treeFromObject(sampleRepo));
    const after = comparable(serializeLogbook(back.logbook));
    // The units/prefs lines of 00-Subsurface are not part of XML exports.
    before.set('00-Subsurface', before.get('00-Subsurface')!.replace('prefs DCCEILING\n', ''));
    expect(describeDifferences(before, after)).toEqual([]);
  });

  it('writes the expected XML for a dive', () => {
    const xml = serializeXml(logbook);
    expect(xml.startsWith("<divelog program='subsurface' version='3'>\n<settings>\n")).toBe(true);
    expect(xml).toContain(
      "<dive number='1' rating='4' visibility='3' sac='22.830 l/min' tags='Training, Lake' divesiteid='  c0ffee' date='2026-04-26' time='10:13:05' duration='42:44 min'>\n" +
        '  <divemaster>Alex Example</divemaster>\n  <buddy>Sam Sample</buddy>\n  <notes>First line\n\nafter empty</notes>\n  <suit>7 mm wetsuit</suit>\n' +
        "  <cylinder size='12.0 l' workpressure='232.0 bar' description='12L Steel' o2='32.0%' start='200.0 bar' end='50.0 bar' />\n",
    );
    expect(xml).toContain("  <sample time='0:00 min' depth='0.0 m' temp='15.2 C' ndl='99:00 min' heartbeat='90' />\n");
    expect(xml).toContain('  <notes>Quote "inside" and backslash \\ end</notes>\n');
    expect(xml.endsWith('</dives>\n</divelog>\n')).toBe(true);
  });

  it('exports only chosen dives with their sites and trip', () => {
    const xml = serializeXml(logbook, { dives: [logbook.dives[0]!] });
    expect(xml.match(/<dive /g)).toHaveLength(1);
    expect(xml).toContain("<site uuid='  c0ffee'");
    expect(xml).not.toContain("<site uuid='    abcd'");
    expect(xml).toContain("<trip date='2026-04-26' time='10:13:05' location='Test Trip, Somewhere'>");
  });

  it('escapes markup in attributes and text', () => {
    const copy = parseLogbook(treeFromObject(sampleRepo)).logbook;
    copy.dives[0]!.buddy = 'A & B <C>';
    copy.dives[0]!.suit = "it's";
    copy.dives[0]!.cylinders[0]!.description = `"x" & 'y'`;
    const xml = serializeXml(copy);
    expect(xml).toContain('<buddy>A &amp; B &lt;C&gt;</buddy>');
    expect(xml).toContain("<suit>it's</suit>");
    expect(xml).toContain("description='&quot;x&quot; &amp; &apos;y&apos;'");
    const back = parseXml(xml).logbook.dives[0]!;
    expect([back.buddy, back.suit, back.cylinders[0]!.description]).toEqual(['A & B <C>', "it's", `"x" & 'y'`]);
  });
});

/**
 * Local only: a real Subsurface repository and an XML export of the same logbook, made by
 * Subsurface itself. Set TOPSIDE_REAL_REPO and TOPSIDE_REAL_SSRF; skipped without them.
 */
const repo = resolve(process.env.TOPSIDE_REAL_REPO ?? join(import.meta.dirname, '../../../../cloud-repo'));
const ssrfDir = resolve(import.meta.dirname, '../../../..');
const ssrf =
  process.env.TOPSIDE_REAL_SSRF ??
  (existsSync(ssrfDir) ? readdirSync(ssrfDir).find((f: string) => f.endsWith('.ssrf')) : undefined);
const ssrfPath = ssrf ? resolve(ssrfDir, ssrf) : '';

describe.skipIf(!existsSync(join(repo, '.git')) || !ssrfPath || !existsSync(ssrfPath))('XML against a real Subsurface export', () => {
  /**
   * The export reflects Subsurface's in-memory state, which differs from the stored files in
   * ways that are not about the file format: tags sorted, strings trimmed, mean depth
   * recomputed. Even those out before comparing.
   */
  function normalize(logbook: Logbook): Logbook {
    for (const d of logbook.dives) {
      d.tags.sort();
      for (const k of ['buddy', 'diveGuide', 'suit', 'notes'] as const) d[k] = d[k].trim();
      for (const c of d.computers) c.meanDepth = Math.round(c.meanDepth / 10);
    }
    return logbook;
  }

  it('reads the export like the repository', () => {
    const fromGit = normalize(parseLogbook(readGitTree(repo)).logbook);
    const parsed = parseXml(readFileSync(ssrfPath, 'utf8'));
    normalize(parsed.logbook);
    expect(parsed.warnings).toEqual([]);
    const a = comparable(serializeLogbook(fromGit));
    const b = comparable(serializeLogbook(parsed.logbook));
    a.set('00-Subsurface', a.get('00-Subsurface')!.replace(/^prefs .*\n/gm, ''));
    expect(describeDifferences(a, b)).toEqual([]);
  });

  it("writes Subsurface's own export back identically (apart from values computed on save)", () => {
    const theirs = readFileSync(ssrfPath, 'utf8')
      .replace(/\r\n/g, '\n')
      // otu and cns come from Subsurface's deco model, which Topside does not have; sac it computes
      .replace(/^(<dive [^>]*?)((?: (?:sac|otu|cns)='[^']*')+)/gm, (_m, head: string, computed: string) =>
        head + computed.replace(/ (?:otu|cns)='[^']*'/g, ''),
      );
    const ours = serializeXml(parseXml(theirs).logbook);
    const o = ours.split('\n');
    const t = theirs.split('\n');
    const first = o.findIndex((line, i) => line !== t[i]);
    expect(first < 0 ? null : `line ${first + 1}\nours:   ${o[first]}\ntheirs: ${t[first]}`).toBeNull();
    expect(o.length).toBe(t.length);
  });
});

/**
 * Compares FIT imports with a real Subsurface repository that already contains the same dives.
 *
 * Real dive data is private and never committed. Set TOPSIDE_REAL_FITS to a folder with FIT files
 * and TOPSIDE_REAL_REPO to a local clone of the matching Subsurface cloud storage; without them
 * the test is skipped.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractFitFiles, findSameDive, importFit, parseLogbook } from '../src/index.ts';
import { readGitTree } from './helpers/git-tree.ts';

const repo = resolve(process.env.TOPSIDE_REAL_REPO ?? join(import.meta.dirname, '../../../../cloud-repo'));
const fitDir = resolve(process.env.TOPSIDE_REAL_FITS ?? join(import.meta.dirname, '../../../../../tauchenSite/dives'));

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name)) : /\.(fit|zip)$/i.test(e.name) ? [join(dir, e.name)] : [],
  );
}

describe.skipIf(!existsSync(join(repo, '.git')) || !existsSync(fitDir))('FIT import against a real repository', () => {
  it('matches the dives Subsurface already has', async () => {
    const { logbook } = parseLogbook(readGitTree(repo));
    const problems: string[] = [];
    let compared = 0;
    let profiles = 0;

    for (const file of listFiles(fitDir)) {
      for (const fit of extractFitFiles(file, new Uint8Array(readFileSync(file)))) {
        const label = fit.activityId ?? fit.name;
        const imported = await importFit(fit.bytes, fit.name, fit.activityId);
        const existing = findSameDive(logbook.dives, imported.dive);
        if (!existing) {
          problems.push(`${label}: no matching dive in the repository`);
          continue;
        }
        compared++;
        const a = imported.dive.computers[0]!;
        const b = existing.computers[0]!;
        const check = (what: string, got: unknown, want: unknown) => {
          if (got !== want) problems.push(`${label}: ${what}: got ${String(got)}, repository has ${String(want)}`);
        };
        check('start time', imported.dive.when, existing.when);
        check('max depth', a.maxDepth, b.maxDepth);
        check('water temperature', a.waterTemp, b.waterTemp);
        check('salinity', a.salinity, b.salinity);
        check('activity id', a.extraData.find((e) => e.key === 'Garmin Connect')?.value, b.extraData.find((e) => e.key === 'Garmin Connect')?.value);
        // Manual entries have no profile, and the user may have stored a dive without one.
        if (imported.manualEntry || b.samples.length < 10) continue;
        profiles++;

        // Flags are not compared: this repository's dives were written by a tool that used
        // simplified severities. Order within the same second is not significant either.
        const brief = (events: typeof a.events) => events.map((e) => `${e.time}/${e.name}`).sort().join(', ');
        check('events', brief(a.events), brief(b.events));
        check('sample count', a.samples.length, b.samples.length);
        for (let i = 0; i < Math.min(a.samples.length, b.samples.length); i++) {
          const s = a.samples[i]!;
          const t = b.samples[i]!;
          // The repository's profiles were written with depths rounded to centimetres.
          const same =
            s.time === t.time && Math.abs(s.depth - t.depth) <= 5 && s.temperature === t.temperature &&
            s.heartbeat === t.heartbeat && s.ndl === t.ndl && s.tts === t.tts && s.cns === t.cns && s.setpoint === t.setpoint;
          if (!same) {
            problems.push(`${label}: sample ${i}: got ${JSON.stringify(s)}, repository has ${JSON.stringify(t)}`);
            break;
          }
        }
      }
    }
    expect(problems.slice(0, 12)).toEqual([]);
    expect(compared).toBeGreaterThan(0);
    expect(profiles).toBeGreaterThan(0);
    console.log(`compared ${compared} dives, ${profiles} with full profile`);
  });
});

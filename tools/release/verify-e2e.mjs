import { isDeepStrictEqual } from 'node:util';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function parseBattleSnapshot(json) {
  const state = JSON.parse(json);
  if (!Number.isInteger(state?.round) || state.round < 1 || typeof state.current !== 'string'
      || !state.current || !Array.isArray(state.hp) || state.hp.length === 0
      || !state.hp.every((hp) => Number.isFinite(hp) && hp >= 0)) {
    throw new Error('Expected round, current actor and nonempty HP array');
  }
  return { round: state.round, current: state.current, hp: state.hp };
}

function checkReload(step) {
  const pair = /^перезагрузка посреди боя: до (.+) → после (.+)$/u.exec(step);
  if (!pair) return 'Incomplete battle snapshots for reload';
  try {
    const before = parseBattleSnapshot(pair[1]);
    const after = parseBattleSnapshot(pair[2]);
    if (!isDeepStrictEqual(before, after)) return `Battle state changed across reload: ${pair[1]} → ${pair[2]}`;
  } catch (error) {
    return `Invalid battle snapshot for reload: ${error.message}`;
  }
}

// The existing T5 runner reports issues without setting a failure exit code.
// Keep the CI gate in T6's directory and reject incomplete runs as well.
export function e2eErrors(report, viewport) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return ['Invalid E2E report'];
  const errors = [];
  if (report.viewport !== viewport) errors.push(`Expected viewport ${viewport}, got ${report.viewport}`);
  if (!Array.isArray(report.issues)) errors.push('Missing issues array');
  else errors.push(...report.issues.map((issue) => `E2E: ${String(issue)}`));
  if (!Array.isArray(report.steps) || report.steps.some((step) => typeof step !== 'string')) return [...errors, 'Invalid steps array'];
  const required = [
    'новая игра: экран гильдии', 'экран героя:', 'экспедиция начата: карта',
    'ручная атака по выбранной цели', 'ручное умение', 'перезагрузка посреди боя:',
    'подготовка к боссу:', 'бой с Костяным королём', 'фаза II Костяного короля',
    'итоги:', 'золото: до', 'возврат в гильдию: activeRun=null,',
  ];
  for (const prefix of required) {
    if (!report.steps.some((step) => step.startsWith(prefix))) errors.push(`E2E did not complete: ${prefix}`);
  }
  for (const step of report.steps.filter((step) => step.startsWith('перезагрузка посреди боя:'))) {
    const error = checkReload(step);
    if (error) errors.push(error);
  }
  const final = report.steps.find((step) => step.startsWith('возврат в гильдию:'));
  if (final && !/^возврат в гильдию: activeRun=null, экспедиций завершено 1$/.test(final)) errors.push('Expected exactly one completed expedition in final state');
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [file, viewport = '1366x768'] = process.argv.slice(2);
    const errors = e2eErrors(JSON.parse(readFileSync(file, 'utf8')), viewport);
    console.log(JSON.stringify({ ok: errors.length === 0, errors }, null, 2));
    if (errors.length) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

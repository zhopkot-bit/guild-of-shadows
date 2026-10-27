// Проверка поставки художника: node tools/art/validate_pack.mjs <путь к art-pack.json> [--strict]
// Проверяет то, что сломает игру или нарушит ТЗ: формат, размеры, альфу, бюджеты, лимит текстуры,
// схему клипов, поля между кадрами (иначе обводка цели «цепляет» соседний кадр).
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const regPath = resolve(process.argv[2] ?? 'public/art/v17/art-pack.json');
const strict = process.argv.includes('--strict');
const errors = [];
const warnings = [];
const info = [];
const MAX_TEX = 4096;
const CLIPS = ['idle', 'attack', 'shoot', 'cast', 'hit', 'death', 'prepare', 'victory'];
const REQUIRED_CLIPS = { heroes: ['idle', 'attack', 'cast', 'hit', 'death'], enemies: ['idle', 'attack', 'hit', 'death'] };
const BUDGET_KB = { atlas: 2500, layer: 450, sprite: 400 };

/** Размер и альфа для WebP (VP8/VP8L/VP8X) и PNG. */
function imageInfo(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 1, 4) === 'PNG') {
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20), ct = b[25];
    return { w, h, alpha: ct === 6 || ct === 4, format: 'png', buf: b };
  }
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') throw new Error('не WebP/PNG');
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), alpha: (b[20] & 0x10) !== 0, format: 'webp' };
  if (chunk === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1, alpha: ((v >> 28) & 1) === 1, format: 'webp' }; }
  return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, alpha: false, format: 'webp' };
}

/** Для PNG проверяем, что у кадров есть прозрачные поля (≥ 4 px) по краям. */
function pngAlphaRows(buf, w, h) {
  const chunks = [];
  let o = 8;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    if (type === 'IDAT') chunks.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = w * 4;
  const px = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? line[x - 4] : 0, up = prev[x], c = x >= 4 ? prev[x - 4] : 0;
      if (f === 1) line[x] = (line[x] + a) & 255;
      else if (f === 2) line[x] = (line[x] + up) & 255;
      else if (f === 3) line[x] = (line[x] + ((a + up) >> 1)) & 255;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c)) & 255; }
    }
    line.copy(px, y * stride);
    prev = line;
  }
  return (x, y) => px[(y * w + x) * 4 + 3];
}

function checkImage(path, label, budgetKb, needAlpha) {
  if (!existsSync(path)) { errors.push(`${label}: нет файла ${path}`); return null; }
  let im;
  try { im = imageInfo(path); } catch (e) { errors.push(`${label}: ${e.message}`); return null; }
  const kb = Math.round(statSync(path).size / 1024);
  if (im.w > MAX_TEX || im.h > MAX_TEX) errors.push(`${label}: ${im.w}×${im.h} больше лимита текстуры ${MAX_TEX}`);
  if (needAlpha && !im.alpha) errors.push(`${label}: нет альфа-канала (нужен настоящий вырез фигуры)`);
  if (kb > budgetKb) (strict ? errors : warnings).push(`${label}: ${kb} КБ больше бюджета ${budgetKb} КБ`);
  info.push(`${label}: ${im.w}×${im.h} ${im.format}${im.alpha ? ' alpha' : ''}, ${kb} КБ`);
  return im;
}

function checkAnim(group, id, rel, base) {
  const p = join(base, rel);
  if (!existsSync(p)) { errors.push(`${group}.${id}: нет ${rel}`); return; }
  let pack;
  try { pack = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { errors.push(`${group}.${id}: JSON не читается (${e.message})`); return; }
  const L = `${group}.${id} (${rel})`;
  if (pack.version !== 1) errors.push(`${L}: version должен быть 1`);
  if (!(pack.frameWidth > 0 && pack.frameHeight > 0)) errors.push(`${L}: нужны frameWidth/frameHeight`);
  if (!Array.isArray(pack.pivot) || pack.pivot.length !== 2 || pack.pivot.some((v) => v < 0 || v > 1)) errors.push(`${L}: pivot — две доли 0..1`);
  const pages = Array.isArray(pack.pages) && pack.pages.length ? pack.pages : pack.image ? [pack.image] : [];
  if (!pages.length) { errors.push(`${L}: нужен image или pages`); return; }
  let total = 0;
  let im = null;
  for (const pg of pages) {
    const pi = checkImage(join(dirname(p), pg), `${L} атлас ${pg}`, BUDGET_KB.atlas, true);
    if (!pi) return;
    if (im && (pi.w !== im.w || pi.h !== im.h)) errors.push(`${L}: страницы атласа разного размера (${pg})`);
    if (pi.w % pack.frameWidth || pi.h % pack.frameHeight) errors.push(`${L}: атлас ${pg} ${pi.w}×${pi.h} не делится на кадр ${pack.frameWidth}×${pack.frameHeight}`);
    if (pi.w > 2048 || pi.h > 2048) warnings.push(`${L}: страница ${pg} больше 2048 — на слабых телефонах лучше 2048`);
    total += Math.floor(pi.w / pack.frameWidth) * Math.floor(pi.h / pack.frameHeight);
    im = im ?? pi;
  }
  for (const name of REQUIRED_CLIPS[group] ?? []) if (!pack.clips?.[name]) errors.push(`${L}: нет обязательного клипа «${name}»`);
  for (const [name, c] of Object.entries(pack.clips ?? {})) {
    if (!CLIPS.includes(name)) warnings.push(`${L}: неизвестный клип «${name}» (игнорируется)`);
    if (!Array.isArray(c.frames) || !c.frames.length) { errors.push(`${L}.${name}: пустой frames`); continue; }
    if (c.frames.some((f) => !Number.isInteger(f) || f < 0 || f >= total)) errors.push(`${L}.${name}: индекс кадра вне атласа (кадров ${total})`);
    if (!(c.fps >= 4 && c.fps <= 30)) errors.push(`${L}.${name}: fps 4..30`);
    if ((name === 'attack' || name === 'shoot' || name === 'cast') && c.impact === undefined) warnings.push(`${L}.${name}: не задан impact (кадр удара)`);
    if (c.impact !== undefined && (c.impact < 0 || c.impact >= c.frames.length)) errors.push(`${L}.${name}: impact вне клипа`);
  }
  if (im.format === 'png' && im.buf) {
    const alpha = pngAlphaRows(im.buf, im.w, im.h);
    const cols = Math.floor(im.w / pack.frameWidth);
    let bad = 0;
    for (let f = 0; f < total; f++) {
      const x0 = (f % cols) * pack.frameWidth, y0 = Math.floor(f / cols) * pack.frameHeight;
      for (let k = 0; k < pack.frameWidth && !bad; k += 3) for (const y of [y0, y0 + 3]) if (alpha(x0 + k, y) > 8) bad++;
    }
    if (bad) warnings.push(`${L}: у кадров нет прозрачного поля сверху (≥ 4 px)`);
  }
}

const RIG_REQUIRED = { heroes: ['idle', 'attack', 'hit', 'death'], enemies: ['idle', 'attack', 'hit', 'death'] };
const RIG_RECOMMENDED = { heroes: ['cast', 'victory'], enemies: ['prepare'] };
function checkRig(group, id, skeRel, atlRel, armName, base) {
  const L = `${group}.${id} (${skeRel})`;
  if (!atlRel) { errors.push(`${L}: к rig нужен rigAtlas (*_tex.json)`); return; }
  const sp = join(base, skeRel), ap = join(base, atlRel);
  if (!existsSync(sp)) { errors.push(`${L}: нет файла`); return; }
  if (!existsSync(ap)) { errors.push(`${L}: нет атласа ${atlRel}`); return; }
  let ske, atl;
  try { ske = JSON.parse(readFileSync(sp, 'utf8')); atl = JSON.parse(readFileSync(ap, 'utf8')); } catch (e) { errors.push(`${L}: JSON не читается (${e.message})`); return; }
  if (ske.version && !String(ske.version).startsWith('5.')) warnings.push(`${L}: версия формата ${ske.version}, проверено на DragonBones 5.5`);
  const arm = (armName ? ske.armature?.find((a) => a.name === armName) : ske.armature?.[0]);
  if (!arm) { errors.push(`${L}: нет арматуры${armName ? ` «${armName}»` : ''}`); return; }
  if (ske.armature.length > 1 && !armName) warnings.push(`${L}: арматур ${ske.armature.length}, берётся первая (задайте rigArmature)`);
  const bones = new Map((arm.bone ?? []).map((b) => [b.name, b]));
  const roots = (arm.bone ?? []).filter((b) => !b.parent);
  if (roots.length !== 1) errors.push(`${L}: должна быть одна корневая кость (найдено ${roots.length})`);
  else if (roots[0].transform && (Math.abs(roots[0].transform.x ?? 0) > 1 || Math.abs(roots[0].transform.y ?? 0) > 1)) warnings.push(`${L}: корневая кость смещена — точка опоры (ноги) должна быть в (0,0)`);
  for (const b of arm.bone ?? []) if (b.parent && !bones.has(b.parent)) errors.push(`${L}: кость ${b.name} ссылается на неизвестного родителя ${b.parent}`);
  if (arm.ik?.length) warnings.push(`${L}: IK не поддерживается рантаймом — запеките IK в ключи костей`);
  if (!arm.aabb) warnings.push(`${L}: нет aabb (будет вычислен по исходной позе)`);
  else if (arm.aabb.y + arm.aabb.height < -2 || arm.aabb.y + arm.aabb.height > arm.aabb.height * 0.15) warnings.push(`${L}: низ aabb (${arm.aabb.y + arm.aabb.height}) далеко от 0 — ноги должны стоять на y = 0`);
  const subs = new Map((atl.SubTexture ?? []).map((t) => [t.name, t]));
  for (const t of atl.SubTexture ?? []) if (t.rotated) errors.push(`${L}: подтекстура ${t.name} повёрнута — выключите Rotation при экспорте атласа`);
  for (const sk of arm.skin ?? []) for (const sl of sk.slot ?? []) for (const d of sl.display ?? []) {
    if (d.type && d.type !== 'image') errors.push(`${L}: слот ${sl.name}: тип «${d.type}» не поддерживается (только image; меши/FFD запеките)`);
    else if (!subs.has(d.name)) errors.push(`${L}: слот ${sl.name}: нет картинки «${d.name}» в атласе`);
  }
  for (const s of arm.slot ?? []) if (!bones.has(s.parent)) errors.push(`${L}: слот ${s.name} на неизвестной кости ${s.parent}`);
  const anims = new Map((arm.animation ?? []).map((a) => [a.name, a]));
  for (const n of RIG_REQUIRED[group] ?? []) if (!anims.has(n)) errors.push(`${L}: нет обязательной анимации «${n}»`);
  for (const n of RIG_RECOMMENDED[group] ?? []) if (!anims.has(n)) warnings.push(`${L}: нет рекомендуемой анимации «${n}» (будет замена)`);
  for (const [n, a] of anims) {
    if (!CLIPS.includes(n)) warnings.push(`${L}: анимация «${n}» не используется игрой`);
    if (n === 'idle' && a.playTimes !== 0) errors.push(`${L}.idle: должна быть зациклена (playTimes 0)`);
    if (n !== 'idle' && n !== 'prepare' && a.playTimes === 0) warnings.push(`${L}.${n}: зациклена, игра ждёт одиночное проигрывание`);
    if (a.ffd?.length || a.ik?.length || (a.slot ?? []).some((s) => s.deformFrame)) warnings.push(`${L}.${n}: деформации/IK в анимации игнорируются`);
    if (['attack', 'shoot', 'cast'].includes(n)) {
      const ev = (a.frame ?? []).some((f) => f.event === 'impact' || (f.events ?? []).some((e) => e.name === 'impact'));
      if (!ev) warnings.push(`${L}.${n}: нет события «impact» в кадре удара`);
    }
    const fr = arm.frameRate ?? ske.frameRate ?? 24;
    const sec = (a.duration ?? 1) / fr;
    if (n !== 'idle' && n !== 'death' && sec > 1.4) warnings.push(`${L}.${n}: ${sec.toFixed(2)} с — длиннее 1,4 с, бой будет ждать`);
  }
  const im = checkImage(join(dirname(ap), atl.imagePath ?? ''), `${L} атлас`, BUDGET_KB.atlas, true);
  if (im) {
    if ((atl.width && atl.width !== im.w) || (atl.height && atl.height !== im.h)) errors.push(`${L}: размер в _tex.json (${atl.width}×${atl.height}) не совпадает с картинкой ${im.w}×${im.h}`);
    if (im.w > 2048 || im.h > 2048) warnings.push(`${L}: атлас больше 2048 — для мобильных лучше 2048`);
    for (const t of atl.SubTexture ?? []) if (t.x + t.width > im.w || t.y + t.height > im.h) errors.push(`${L}: подтекстура ${t.name} выходит за атлас`);
  }
  info.push(`${L}: костей ${bones.size}, слотов ${(arm.slot ?? []).length}, анимации ${[...anims.keys()].join(', ')}`);
}

// ---------- Наборы поз (основной формат для генеративного арта) ----------
const POSES = ['idle', 'windup', 'strike', 'aim', 'shoot', 'cast', 'prepare', 'hit', 'down', 'victory'];
/** Какие позы реально нужны каждому персонажу (по его действиям в бою). */
const POSE_REQUIRED = {
  bran: ['idle', 'windup', 'strike', 'cast', 'hit', 'down', 'victory'],
  mira: ['idle', 'aim', 'shoot', 'windup', 'strike', 'hit', 'down', 'victory'],
  rook: ['idle', 'aim', 'shoot', 'hit', 'down', 'victory'],
  nora: ['idle', 'aim', 'shoot', 'cast', 'hit', 'down', 'victory'],
  goblinRaider: ['idle', 'windup', 'strike', 'hit', 'down'],
  ashWolf: ['idle', 'windup', 'strike', 'hit', 'down'],
  boneGuard: ['idle', 'windup', 'strike', 'prepare', 'hit', 'down'],
  ashMage: ['idle', 'aim', 'shoot', 'prepare', 'hit', 'down'],
  boneKing: ['idle', 'windup', 'strike', 'prepare', 'hit', 'down'],
};
const POSE_BUDGET_KB = { image: 160, character: 1200 };

/** Границы непрозрачной области PNG (альфа > 24). */
function pngOpaqueBox(buf, w, h) {
  const alpha = pngAlphaRows(buf, w, h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (alpha(x, y) > 24) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

function checkPoses(group, id, rel, base) {
  const p = join(base, rel);
  const L = `${group}.${id} (${rel})`;
  if (!existsSync(p)) { errors.push(`${L}: нет файла`); return; }
  let pack;
  try { pack = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { errors.push(`${L}: JSON не читается (${e.message})`); return; }
  if (pack.version !== 1) errors.push(`${L}: version должен быть 1`);
  if (!(pack.frameWidth > 0 && pack.frameHeight > 0)) { errors.push(`${L}: нужны frameWidth/frameHeight`); return; }
  if (!Array.isArray(pack.pivot) || pack.pivot.length !== 2 || pack.pivot.some((v) => !(v >= 0 && v <= 1))) errors.push(`${L}: pivot — две доли 0..1 (точка между ступнями)`);
  if (!(pack.figureHeight > 0 && pack.figureHeight <= 1)) errors.push(`${L}: figureHeight — доля 0..1 высоты холста под стоящую фигуру`);
  if (pack.fps !== undefined && !(pack.fps >= 2 && pack.fps <= 30)) errors.push(`${L}: fps 2..30`);
  if (pack.frameHeight > 2048 || pack.frameWidth > 2048) errors.push(`${L}: холст ${pack.frameWidth}×${pack.frameHeight} больше 2048`);
  else if (pack.frameHeight > 1024) warnings.push(`${L}: холст выше 1024 px — хватит 768 (видеопамять телефона: ~20 МБ на персонажа)`);
  const poses = pack.poses ?? {};
  for (const n of Object.keys(poses)) if (!POSES.includes(n)) warnings.push(`${L}: неизвестная поза «${n}» (игнорируется)`);
  for (const n of POSE_REQUIRED[id] ?? ['idle']) if (!poses[n]) errors.push(`${L}: нет позы «${n}» — она нужна этому персонажу в бою`);
  let totalKb = 0;
  for (const n of POSES) {
    const list = typeof poses[n] === 'string' ? [poses[n]] : Array.isArray(poses[n]) ? poses[n] : [];
    if (poses[n] !== undefined && !list.length) errors.push(`${L}.${n}: пустая серия`);
    if (list.length > 4) warnings.push(`${L}.${n}: ${list.length} картинок — серия длиннее 4 читается как дёрганый мультфильм`);
    for (const f of list) {
      const ip = join(dirname(p), f);
      const im = checkImage(ip, `${L}.${n} ${f}`, POSE_BUDGET_KB.image, true);
      if (!im) continue;
      totalKb += statSync(ip).size / 1024;
      if (im.w !== pack.frameWidth || im.h !== pack.frameHeight) errors.push(`${L}.${n} ${f}: ${im.w}×${im.h}, а холст ${pack.frameWidth}×${pack.frameHeight} — все позы на холсте одного размера`);
      if (im.format === 'png' && im.buf && n !== 'down') {
        // Ступни на одной линии: низ фигуры (кроме лежачей позы) совпадает с точкой опоры.
        const box = pngOpaqueBox(im.buf, im.w, im.h);
        if (box) {
          const feet = (box.y1 + 1) / im.h;
          if (Math.abs(feet - pack.pivot[1]) > 0.025) errors.push(`${L}.${n} ${f}: ступни на ${(feet * 100).toFixed(1)}% высоты, а pivot — ${(pack.pivot[1] * 100).toFixed(1)}% (фигура «прыгнет» при смене позы)`);
          if (n === 'idle') {
            const fh = (box.y1 - box.y0 + 1) / im.h;
            if (Math.abs(fh - pack.figureHeight) > 0.06) errors.push(`${L}.idle: фигура занимает ${(fh * 100).toFixed(0)}% высоты, а figureHeight — ${(pack.figureHeight * 100).toFixed(0)}%`);
            const cx = (box.x0 + box.x1) / 2 / im.w;
            if (Math.abs(cx - pack.pivot[0]) > 0.12) warnings.push(`${L}.idle: центр фигуры (${(cx * 100).toFixed(0)}%) далеко от pivot по горизонтали (${(pack.pivot[0] * 100).toFixed(0)}%)`);
          }
        }
      } else if (im.format !== 'png') info.push(`${L}.${n} ${f}: WebP — проверка ступней только по PNG-мастерам`);
    }
  }
  if (totalKb > POSE_BUDGET_KB.character) (strict ? errors : warnings).push(`${L}: ${Math.round(totalKb)} КБ на персонажа больше бюджета ${POSE_BUDGET_KB.character} КБ`);
  info.push(`${L}: поз ${Object.keys(poses).length}, ${Math.round(totalKb)} КБ`);
}

if (!existsSync(regPath)) {
  console.error(`Нет реестра ${regPath}`);
  process.exit(2);
}
const reg = JSON.parse(readFileSync(regPath, 'utf8'));
const base = dirname(regPath);
if (reg.version !== 1) errors.push('art-pack.json: version должен быть 1');
const KNOWN = { heroes: ['bran', 'mira', 'rook', 'nora'], enemies: ['goblinRaider', 'ashWolf', 'boneGuard', 'ashMage', 'boneKing'] };
for (const group of ['heroes', 'enemies']) {
  for (const [id, e] of Object.entries(reg[group] ?? {})) {
    if (!KNOWN[group].includes(id)) errors.push(`${group}.${id}: неизвестный id (ожидается ${KNOWN[group].join(', ')})`);
    if (e.poses) checkPoses(group, id, e.poses, base);
    if (e.phase2Poses) checkPoses(group, id, e.phase2Poses, base);
    if (e.anim) checkAnim(group, id, e.anim, base);
    if (e.phase2Anim) checkAnim(group, id, e.phase2Anim, base);
    if (e.rig) checkRig(group, id, e.rig, e.rigAtlas, e.rigArmature, base);
    if (e.phase2Rig) checkRig(group, id, e.phase2Rig, e.phase2RigAtlas, e.rigArmature, base);
    if (e.anim && e.rig) warnings.push(`${group}.${id}: заданы и anim, и rig — игра возьмёт rig`);
    if ((e.phase2Rig || e.phase2Anim || e.phase2Sprite || e.phase2Poses) && id !== 'boneKing') warnings.push(`${group}.${id}: II фаза есть только у boneKing`);
    if (e.phase2Sprite) checkImage(join(base, e.phase2Sprite), `${group}.${id} спрайт фазы II`, BUDGET_KB.sprite, true);
  }
}
for (const [id, a] of Object.entries(reg.arenas ?? {})) {
  if (!['crypt', 'boss'].includes(id)) warnings.push(`arenas.${id}: игра использует crypt и boss`);
  for (const l of a.layers ?? []) {
    const im = checkImage(join(base, l.src), `arenas.${id} слой ${l.src}`, BUDGET_KB.layer, !!l.front);
    if (im && (im.w < 1920 || im.h < 1080)) errors.push(`arenas.${id} слой ${l.src}: минимум 1920×1080`);
    if (!(l.parallax >= 0 && l.parallax <= 2)) errors.push(`arenas.${id} слой ${l.src}: parallax 0..2`);
  }
}
const report = { registry: regPath, ok: errors.length === 0, errors, warnings, info };
console.log(JSON.stringify(report, null, 1));
process.exit(errors.length ? 1 : 0);

/**
 * Tests puros de ui/office.js (Pixel Office v3 — director de escena, TASK-03).
 * 100% Node.js nativo; sin DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERNAL_WIDTH,
  INTERNAL_HEIGHT,
  POSES,
  LANE_Y,
  CELEBRATE_MS,
  MAX_PENDING,
  EMOTES,
  EMOTE_MS,
  CONFETTI_COUNT,
  CONFETTI_MS,
  CONFETTI_COLORS,
  JINGLE_NOTES,
  JINGLE_GAIN,
  buildAgentSprite,
  buildChoreography,
  buildEmoteSchedule,
  buildEmoteSprite,
  confettiAt,
  createConfetti,
  createRng,
  createSceneDirector,
  detectTransition,
  emotesAt,
  interpolatePath,
  scheduleJingle,
  agentAnchor,
} from '../ui/office.js';

test('detectTransition: tabla de transiciones del pipeline', () => {
  assert.equal(detectTransition('planning', 'code'), 'handoff-plan');
  assert.equal(detectTransition('code', 'qa'), 'handoff-code');
  assert.equal(detectTransition('fix', 'qa'), 'handoff-code');
  assert.equal(detectTransition('changes_required', 'qa'), 'handoff-code');
  assert.equal(detectTransition('qa', 'changes_required'), 'return-fix');
  assert.equal(detectTransition('qa', 'fix'), 'return-fix');
  assert.equal(detectTransition('idle', 'approved'), 'celebrate');
  assert.equal(detectTransition('qa', 'approved'), 'celebrate');
  assert.equal(detectTransition('fix', 'approved'), 'celebrate');

  assert.equal(detectTransition('approved', 'approved'), null);
  assert.equal(detectTransition('qa', 'qa'), null);
  assert.equal(detectTransition('planning', 'fix'), null);
  assert.equal(detectTransition('idle', 'code'), null);
  assert.equal(detectTransition('code', 'planning'), null);
  assert.equal(detectTransition('qa', 'nope'), null);
  assert.equal(detectTransition(null, 'code'), null);
});

test('director: ignora el idle momentáneo entre pasos (code → idle → qa)', () => {
  const d = createSceneDirector('code');
  d.push('idle', 100);
  d.push('qa', 200);
  assert.deepEqual(d.getPending(), ['handoff-code']);
  assert.equal(d.tick(200), 'handoff-code');
});

test('director: un ciclo de fix no duplica return-fix', () => {
  const d = createSceneDirector('qa');
  d.push('changes_required', 100);
  d.push('fix', 200);
  d.push('changes_required', 300);
  d.push('qa', 400);
  assert.deepEqual(d.getPending(), ['return-fix', 'handoff-code']);
});

test('director: la cola respeta MAX_PENDING y descarta las más viejas', () => {
  const d = createSceneDirector('planning');
  d.push('code', 100);
  d.push('qa', 200);
  d.push('fix', 300);
  d.push('qa', 400);
  d.push('approved', 500);
  assert.equal(d.getPending().length, MAX_PENDING);
  assert.deepEqual(d.getPending(), ['handoff-code', 'celebrate']);
});

test('director: tick encadena coreografías por duración y skipToEnd limpia todo', () => {
  const d = createSceneDirector('planning');
  d.push('code', 0);
  d.push('qa', 0);
  const dur = buildChoreography('handoff-plan').duration;
  assert.equal(d.tick(0), 'handoff-plan');
  assert.equal(d.tick(dur - 1), 'handoff-plan');
  assert.equal(d.tick(dur), 'handoff-code');
  d.skipToEnd();
  assert.equal(d.tick(dur + 1), null);
  assert.equal(d.snapshot(dur + 1), null);
  assert.equal(d.getLastActive(), 'qa');
});

test('buildChoreography: waypoints fijos, enteros y dentro del canvas', () => {
  for (const type of ['handoff-plan', 'handoff-code', 'return-fix']) {
    const c = buildChoreography(type);
    const A = agentAnchor({ col: { planner: 3, coder: 9, qa: 15 }[c.actor], row: 5 });
    assert.deepEqual([c.path[0].x, c.path[0].y], [A.x, A.y], `${type}: path[0] = anchor del actor`);
    const last = c.path.at(-1);
    assert.deepEqual([last.x, last.y], [A.x, A.y], `${type}: último punto = anchor del actor`);
    for (const p of c.path.slice(1, 5)) {
      assert.equal(p.y, LANE_Y, `${type}: los puntos intermedios van por el pasillo`);
    }
    for (let i = 1; i < c.path.length; i++) {
      assert.ok(c.path[i].t > c.path[i - 1].t, `${type}: t estrictamente creciente`);
    }
    assert.equal(c.duration, last.t, `${type}: duration === último t`);
    assert.ok(c.dropT > c.path[2].t && c.dropT < c.path[3].t, `${type}: dropT dentro de la pausa`);

    for (let t = 0; t <= c.duration; t += 50) {
      const pos = interpolatePath(c.path, t);
      assert.ok(Number.isInteger(pos.x) && Number.isInteger(pos.y), `${type}@${t}: enteros`);
      assert.ok(pos.x >= 0 && pos.x <= INTERNAL_WIDTH - 16, `${type}@${t}: x=${pos.x} dentro del canvas`);
      assert.ok(pos.y >= 0 && pos.y <= INTERNAL_HEIGHT - 24, `${type}@${t}: y=${pos.y} dentro del canvas`);
    }
  }

  const plan = buildChoreography('handoff-plan');
  assert.equal(plan.path[2].x, 138);
  assert.equal(plan.actor, 'planner');
  assert.equal(plan.prop, 'scroll');

  const ret = buildChoreography('return-fix');
  assert.equal(ret.path[2].x, 166);
  assert.equal(ret.prop, 'box');

  const celebrate = buildChoreography('celebrate');
  assert.equal(celebrate.duration, CELEBRATE_MS);
  assert.deepEqual(celebrate.path, []);

  assert.equal(buildChoreography('nope'), null);
});

test('snapshot: pose y objeto según el momento de la coreografía', () => {
  const d = createSceneDirector('planning');
  d.push('code', 0);
  assert.equal(d.tick(0), 'handoff-plan');
  const c = buildChoreography('handoff-plan');

  const snap0 = d.snapshot(0);
  assert.equal(snap0.actor, 'planner');
  assert.equal(snap0.pose, 'walk');
  assert.equal(snap0.prop.kind, 'scroll');
  assert.equal(snap0.prop.x, snap0.x + 11);

  const midHold = Math.round((c.path[2].t + c.path[3].t) / 2);
  assert.equal(d.snapshot(midHold).pose, 'idle');

  const afterDrop = d.snapshot(c.dropT + 1);
  assert.equal(afterDrop.prop.x, 152 + 5);
  assert.equal(afterDrop.prop.y, 81 + 1);

  assert.equal(POSES.walk.frames, 2);
  assert.equal(buildAgentSprite('walk', 1).dy, -1);
});

test('director: push devuelve la transición detectada', () => {
  const d = createSceneDirector('planning');
  assert.equal(d.push('code', 0), 'handoff-plan');
  assert.equal(d.push('idle', 1), null);
  assert.equal(d.push('qa', 2), 'handoff-code');
  assert.equal(d.push('qa', 3), null);
  assert.equal(d.push('nope', 4), null);
});

test('buildEmoteSprite: 4 emotes de 9×10 con paleta completa', () => {
  for (const kind of EMOTES) {
    const sprite = buildEmoteSprite(kind);
    assert.ok(sprite, `falta el emote ${kind}`);
    assert.equal(sprite.rows.length, 10, `${kind}: 10 filas`);
    for (const row of sprite.rows) {
      assert.equal(row.length, 9, `${kind}: fila de 9 chars: "${row}"`);
      for (const ch of row) {
        if (ch !== '.') assert.ok(sprite.palette[ch], `${kind}: "${ch}" sin color en la paleta`);
      }
    }
  }
  assert.equal(buildEmoteSprite('x'), null);
});

test('buildEmoteSchedule: emotes por coreografía', () => {
  const plan = buildChoreography('handoff-plan');
  const schedPlan = buildEmoteSchedule(plan);
  assert.equal(schedPlan.length, 1);
  assert.equal(schedPlan[0].desk, 'coder');
  assert.equal(schedPlan[0].kind, 'alert');
  assert.equal(schedPlan[0].start, plan.dropT);

  const code = buildChoreography('handoff-code');
  const schedCode = buildEmoteSchedule(code);
  assert.ok(schedCode.some((e) => e.desk === 'qa' && e.kind === 'alert'));
  const coffee = schedCode.find((e) => e.desk === 'coder' && e.kind === 'coffee');
  assert.ok(coffee, 'handoff-code incluye el café del coder');
  assert.equal(coffee.end, code.duration);

  const ret = buildChoreography('return-fix');
  const schedRet = buildEmoteSchedule(ret);
  assert.ok(schedRet.some((e) => e.desk === 'qa' && e.kind === 'angry' && e.start === 0));
  assert.ok(schedRet.some((e) => e.desk === 'coder' && e.kind === 'alert'));

  const celebrate = buildChoreography('celebrate');
  const schedCel = buildEmoteSchedule(celebrate);
  assert.equal(schedCel.length, 3);
  for (const e of schedCel) {
    assert.equal(e.kind, 'love');
    assert.equal(e.end, CELEBRATE_MS);
  }

  assert.deepEqual(buildEmoteSchedule(null), []);
  assert.deepEqual(buildEmoteSchedule(buildChoreography('nope')), []);

  for (const choreo of [plan, code, ret, celebrate]) {
    for (const e of buildEmoteSchedule(choreo)) {
      assert.ok(Number.isInteger(e.start) && Number.isInteger(e.end), 'ventanas enteras');
      assert.ok(e.start >= 0 && e.start < e.end && e.end <= choreo.duration, `ventana válida: ${JSON.stringify(e)}`);
    }
  }
});

test('emotesAt + snapshot.emotes', () => {
  const plan = buildChoreography('handoff-plan');
  assert.deepEqual(emotesAt(plan, 0), []);
  const atDrop = emotesAt(plan, plan.dropT);
  assert.ok(atDrop.some((e) => e.desk === 'coder' && e.kind === 'alert'));

  const d = createSceneDirector('qa');
  d.push('approved', 0);
  assert.equal(d.tick(0), 'celebrate');
  const snap = d.snapshot(0);
  assert.equal(snap.emotes.length, 3);
});

test('confeti determinista, entero y finito', () => {
  const a = createConfetti(7);
  assert.equal(a.length, CONFETTI_COUNT);
  assert.deepEqual(a, createConfetti(7));
  assert.notDeepEqual(a, createConfetti(8));

  const visible = confettiAt(a, 500);
  assert.ok(visible.length > 0, 'a los 500 ms debe haber confeti visible');
  for (const p of visible) {
    assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y), 'posiciones enteras');
    assert.ok(p.x >= 0 && p.x < INTERNAL_WIDTH && p.y >= 0 && p.y < INTERNAL_HEIGHT, 'dentro del canvas');
    assert.ok(CONFETTI_COLORS.includes(p.color), 'color de la paleta');
  }

  assert.deepEqual(confettiAt(a, CONFETTI_MS), []);
  assert.deepEqual(confettiAt(a, -1), []);
  assert.deepEqual(confettiAt(a, NaN), []);

  const r = createRng(1)();
  assert.ok(r >= 0 && r < 1, 'createRng devuelve [0, 1)');
});

test('scheduleJingle programa 4 notas cuadradas en un doble de AudioContext', () => {
  const calls = { osc: [], gains: [] };
  const ac = {
    currentTime: 10,
    destination: {},
    createOscillator() {
      const osc = {
        type: null,
        frequency: {
          setValueAtTime: (freq, t) => { osc.freq = freq; osc.freqAt = t; },
        },
        connect: (node) => { osc.connectedTo = node; },
        start: (t) => { osc.startedAt = t; },
        stop: (t) => { osc.stoppedAt = t; },
      };
      calls.osc.push(osc);
      return osc;
    },
    createGain() {
      const g = {
        gain: {
          values: [],
          setValueAtTime(v, t) { this.values.push({ v, t, kind: 'set' }); },
          linearRampToValueAtTime(v, t) { this.values.push({ v, t, kind: 'ramp' }); },
        },
        connect: (node) => { g.connectedTo = node; },
      };
      calls.gains.push(g);
      return g;
    },
  };

  assert.equal(scheduleJingle(ac), 4);
  assert.deepEqual(calls.osc.map((o) => o.freq), JINGLE_NOTES.map((n) => n.freq));
  for (const osc of calls.osc) {
    assert.equal(osc.type, 'square');
  }
  assert.equal(calls.osc[0].startedAt, 10);
  for (const g of calls.gains) {
    for (const { v } of g.gain.values) {
      assert.ok(v <= JINGLE_GAIN, `ganancia ${v} ≤ JINGLE_GAIN`);
    }
    assert.equal(g.connectedTo, ac.destination);
  }

  assert.equal(scheduleJingle(null), 0);
});

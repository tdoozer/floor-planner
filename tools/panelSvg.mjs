// Генератор однолинейной схемы щитов. Рисует ИЗ МОДЕЛИ (calc/panel.js
// и calc/emergencyPanel.js), поэтому схема не может разойтись с расчётом:
// поменяли номинал в модели — перерисовали и получили другую картинку.
//
// Запуск: node tools/panelSvg.mjs > docs/panel.svg

import { panelPlan } from '../src/calc/panel.js';
import { emergencyPanel } from '../src/calc/emergencyPanel.js';
import { SW500L, TOPOLOGY, upsSizing } from '../src/calc/ups.js';

const P = panelPlan();
const EP = emergencyPanel({ inverterW: SW500L.watts });
const UPS = upsSizing({
  boilerW: 110, alwaysOnW: 25, topology: TOPOLOGY.online,
  chargerA: SW500L.chargerA, deviceMaxBankAh: SW500L.maxBankAh,
  depth: SW500L.dodCutoff, targetHours: 12
});
const BANK = UPS.options.find((o) => o.id === 'agm100x2');

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#334155';
const NEW = '#dc2626';
const SOFT = '#f1f5f9';
const W = 1040;
const H = 1330;

const out = [];
const push = (...x) => out.push(...x);
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const text = (x, y, t, { size = 11, fill = INK, weight = 400, anchor = 'start' } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}">${esc(t)}</text>`;

const box = (x, y, w, h, { stroke = LINE, fill = SOFT, sw = 1.4, dash = null } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;

const line = (x1, y1, x2, y2, { stroke = LINE, sw = 1.6, dash = null } = {}) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;

// Перенос подписи в несколько строк по ширине в символах
function wrap(t, n) {
  const words = t.split(' ');
  const rows = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > n) { rows.push(cur.trim()); cur = w; }
    else cur += ' ' + w;
  }
  if (cur.trim()) rows.push(cur.trim());
  return rows;
}

push(`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Однолинейная схема щитов">`);
push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
push(text(16, 26, 'Однолинейная схема: ввод, распределение и аварийное питание', { size: 15, weight: 700 }));
push(text(16, 44, 'Красным — то, что добавляется или заменяется. Остальное на месте.', { size: 11, fill: MUTED }));

// ─────────── ВЩ ───────────
const vx = 150; // вертикальная шина ВЩ
push(box(30, 62, 980, 372, { fill: 'none', stroke: '#cbd5e1', dash: '5 4', sw: 1.2 }));
push(text(44, 82, 'ВЩ — ввод и учёт, СНАРУЖИ. Опломбирован сетевой организацией', { size: 12, weight: 700 }));
push(text(44, 98, `на DIN-рейке ${P.outdoor.used} из ${P.outdoor.modules} модулей · счётчик на своей панели, места на рейке не занимает`, { size: 10.5, fill: MUTED }));

// ввод
push(line(vx, 112, vx, 130));
push(text(vx + 14, 122, 'Воздушный ввод (СИП)', { size: 11, weight: 700 }));

const vsch = [
  ['PI', 'Меркурий 203.1', `${P.existing.meter.rating}, ${P.existing.meter.year} г. Поверка до ${P.existing.meter.year + P.existing.meter.calibrationYears}. Менять — обязанность сетевой, не ваша`, false],
  ['QF1', `Вводной 2P C${P.input.rating}`, `${(P.input.limitW / 1000).toFixed(1)} кВт — потолок по договору. Проверить договор: это единственная цифра, которую нельзя выбрать`, false],
  ['KV1', 'Реле напряжения', 'ЗАМЕНА: с АВТОВОЗВРАТОМ вместо РММ47. Сейчас после просадки автомат остаётся выключен до ручного взвода — в пустом доме это замороженный дом', true],
  ['FV1', 'УЗИП класс II', 'Уже стоит. Воздушный ввод в деревне — грозовые импульсы реальны', false],
  ['QD1', 'УЗО 300 мА, тип S', 'ДОБАВИТЬ: противопожарное. Тип S обязателен — без выдержки времени оно выбьет вместе с групповыми 30 мА', true]
];

let y = 142;
for (const [id, name, note, isNew] of vsch) {
  const col = isNew ? NEW : LINE;
  push(line(vx, y, vx, y + 12, { stroke: LINE }));
  push(box(vx - 60, y + 12, 120, 34, { stroke: col, sw: isNew ? 2 : 1.4 }));
  push(text(vx, y + 27, id, { size: 10, fill: MUTED, anchor: 'middle' }));
  push(text(vx, y + 40, name, { size: 11, weight: 700, fill: col, anchor: 'middle' }));
  const rows = wrap(note, 76);
  rows.forEach((r, i) => push(text(vx + 76, y + 27 + i * 13, r, { size: 10, fill: i === 0 && isNew ? NEW : MUTED })));
  y += 58;
}

// сервисная розетка отводом
push(line(vx, y, vx, y + 10));
push(line(vx, y + 10, vx + 300, y + 10, { dash: '4 3' }));
push(box(vx + 300, y - 6, 96, 30, { stroke: LINE }));
push(text(vx + 348, y + 13, 'XS1 розетка', { size: 10.5, anchor: 'middle' }));
push(text(vx + 404, y + 13, 'сервисная, есть', { size: 10, fill: MUTED }));

// кабель в дом
push(line(vx, y + 10, vx, 452));
push(text(vx + 14, 448, 'ВВГнг-LS 3×6 в дом', { size: 11, weight: 700 }));

// ─────────── ЩР ───────────
push(box(30, 462, 980, 400, { fill: 'none', stroke: '#cbd5e1', dash: '5 4', sw: 1.2 }));
push(text(44, 482, 'ЩР — распределительный, В ПРИХОЖЕЙ, 24 модуля', { size: 12, weight: 700 }));
push(text(44, 498, `занято ${P.indoor.used}, свободно ${P.indoor.free} · вся группировка уезжает с улицы внутрь: электронные дифавтоматы работают от −25 °C, а расчётная наружная −27`, { size: 10.5, fill: MUTED }));

push(line(vx, 452, vx, 516));
push(box(vx - 60, 516, 120, 32, { stroke: LINE }));
push(text(vx, 530, 'QF0', { size: 10, fill: MUTED, anchor: 'middle' }));
push(text(vx, 542, 'Выкл. нагрузки 2P 40 А', { size: 9.5, weight: 700, anchor: 'middle' }));
push(text(vx + 76, 536, 'обесточить дом, не выходя на улицу', { size: 10, fill: MUTED }));

// шина
const busY = 580;
push(line(vx, 548, vx, busY));
const cols = [100, 233, 366, 499, 632, 765, 898];
push(line(cols[0], busY, cols[cols.length - 1], busY, { sw: 2.4 }));

const groups = P.indoor.devices.filter((d) => d.circuit);
groups.forEach((d, i) => {
  const x = cols[i];
  const isBoiler = d.circuit === 'boiler';
  push(line(x, busY, x, busY + 18));
  push(box(x - 59, busY + 18, 118, 40, { stroke: isBoiler ? NEW : LINE, sw: isBoiler ? 2 : 1.4 }));
  push(text(x, busY + 33, d.id, { size: 10, fill: MUTED, anchor: 'middle' }));
  const parts = d.label.split(' — ');
  push(text(x, busY + 50, parts[1] ?? '', { size: 10.5, weight: 700, anchor: 'middle', fill: isBoiler ? NEW : INK }));
  wrap(parts[0], 20).forEach((r, k) =>
    push(text(x, busY + 76 + k * 13, r, { size: 10, fill: MUTED, anchor: 'middle' })));
});

// ─────────── ИБП и ЩАП ───────────
const bx = cols[cols.length - 1];
push(line(bx, busY + 58, bx, 890));
push(line(bx, 890, 250, 890));
push(line(250, 890, 250, 906));
push(box(150, 906, 200, 44, { stroke: NEW, sw: 2 }));
push(text(250, 922, `${SW500L.model} ${SW500L.va} ВА / ${SW500L.watts} Вт`, { size: 11, weight: 700, fill: NEW, anchor: 'middle' }));
push(text(250, 938, `+ 2 × АКБ 100 А·ч (шина ${SW500L.busV} В) — ${BANK.hours.toFixed(1).replace('.', ',')} ч`, { size: 10, fill: MUTED, anchor: 'middle' }));
push(text(366, 918, `под окном прихожей: ниша 900 × 1100. ИБП ${SW500L.sizeMm.w}×${SW500L.sizeMm.h}×${SW500L.sizeMm.dBracket}, ${SW500L.massKg} кг`, { size: 10, fill: MUTED }));
push(text(366, 932, `у ИБП на выходе ОДНА розетка Schuko (${SW500L.outlets}) — отсюда и щиток ниже`, { size: 10, fill: MUTED }));
push(text(366, 946, `заряд банка обратно ${BANK.recharge.total.toFixed(0)} ч. ИБП только в помещении: от +${SW500L.tempC[0]} °C`, { size: 10, fill: MUTED }));

push(box(30, 968, 980, 342, { fill: 'none', stroke: '#cbd5e1', dash: '5 4', sw: 1.2 }));
push(text(44, 988, 'ЩАП — аварийный, после ИБП, 8 модулей', { size: 12, weight: 700 }));
push(text(44, 1004, `занято ${EP.modulesUsed}, свободно ${EP.modulesFree} · у каждой ветки свой аппарат, поэтому авария в одной до котла НЕ доходит`, { size: 10.5, fill: MUTED }));

push(line(250, 950, 250, 1022));
const abusY = 1048;
const acols = [250, 440, 630, 820];
push(line(250, 1022, 250, abusY));
push(line(acols[0], abusY, acols[acols.length - 1], abusY, { sw: 2.4 }));

EP.branches.forEach((b, i) => {
  const x = acols[i];
  const dev = b.rcd ? `B${b.breaker} А + диф ${b.rcdMa} мА` : `${b.breaker} А`;
  push(line(x, abusY, x, abusY + 18));
  push(box(x - 82, abusY + 18, 164, 42, { stroke: b.rcd ? NEW : LINE, sw: b.rcd ? 2 : 1.4 }));
  push(text(x, abusY + 34, b.label, { size: 11, weight: 700, anchor: 'middle' }));
  push(text(x, abusY + 50, dev, { size: 10, fill: b.rcd ? NEW : MUTED, anchor: 'middle' }));
  push(text(x, abusY + 78, `${b.watts} Вт`, { size: 10.5, weight: 700, fill: MUTED, anchor: 'middle' }));
});

const notes = [
  `Пик аварийной линии ${EP.socket.peakW} Вт из ${EP.inverterW}. Автомат розетки считается НЕ по кабелю, а по остатку инвертора:`,
  `${EP.inverterW} − ${EP.baseW} = ${EP.socket.spareW} Вт = ${EP.socket.spareA.toFixed(2)} А. Характеристика B, не C: чайник 2 кВт это 9 номиналов, B отсекает мгновенно.`,
  'Светильник — класса II: заземляемых частей нет, значит утечку на землю создать нечем, и общее УЗО котла он не потревожит.'
];
notes.forEach((n, i) => push(text(44, 1180 + i * 15, n, { size: 10, fill: i < 2 ? NEW : MUTED })));

// селективность
push(text(44, 1240, 'Селективность по току утечки, сверху вниз:', { size: 11, weight: 700 }));
P.chain.forEach((c, i) =>
  push(text(44 + i * 250, 1258, `${c.at} — ${c.ma} мА, тип ${c.type}`, { size: 10, fill: MUTED })));
push(text(44, 1284, 'Групповые 30 мА мгновенные, вводное 300 мА с выдержкой. Без типа S вводное выбивало бы вместе с групповым и селективности не было бы.', { size: 10, fill: MUTED }));

push('</svg>');
process.stdout.write(out.join('\n') + '\n');

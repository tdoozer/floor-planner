// Спецификация материалов по полу и тёплому полу.
//
// Всё выводится ИЗ ГЕОМЕТРИИ: поменяли толщину ЭППС или сдвинули перегородку —
// объёмы пересчитались. Никаких зашитых количеств.
//
// Отделка, электрика, лестница и сантехразводка сюда НЕ входят: по ним пока
// нет решений, а выдавать придуманные цифры за спецификацию нельзя.

import { INNER_D, INNER_W, buildRooms, buildWalls } from '../data/project.js';
import { polygonArea, wallVector } from './geometry.js';
import { PRICEBOOK_META, lineCost, packOf } from '../data/pricebook.js';
import { buildWorktop } from '../data/worktop.js';
import { stairFabrication, worktopFabrication } from './fabrication.js';

// Коэффициенты запаса
export const WASTE = {
  insulation: 1.05, // trimming of boards
  waterproofing: 1.25, // overlaps and turn-up onto the walls
  mesh: 1.1, // overlap of sheets
  pipe: 1.08, // allowance for feeds and mistakes
  sandCompaction: 1.15, // loose volume against compacted
  gravelCompaction: 1.2
};

// Плотности и нормы расхода
export const RATES = {
  screedDensity: 2000, // kg/m³ of cement-sand screed
  cementPerM3: 400, // kg of M500 cement per 1 m³ of M300 mortar
  sandPerM3: 1.1, // m³ of sand per 1 m³ of mortar
  fibrePerM3: 0.9, // kg of polypropylene fibre
  plasticiserPerCement: 0.01, // l per kg of cement
  tiesPerMetre: 2, // ties per running metre of pipe
  bagCement: 25, // kg in a bag
  meshSheet: 6, // m² in a 2 × 3 sheet
  insulationSheet: 0.684 // m² in a 1180 × 580 board
};

const up = (v) => Math.ceil(v);

// Позиции электрики. Кабель берётся из посчитанных трасс, приборы —
// из фактически расставленных точек, а не из головы.
function electricalItems(electrical) {
  if (!electrical?.points?.length) return [];

  const byId = electrical.points.reduce((acc, p) => {
    acc[p.catalogId] = (acc[p.catalogId] ?? 0) + 1;
    return acc;
  }, {});

  const cable = electrical.byCircuit.reduce(
    (acc, g) => {
      const key = g.cable === '3×1.5' ? 'light' : 'power';
      acc[key] += g.cableM;
      return acc;
    },
    { light: 0, power: 0 }
  );

  const socketCount =
    (byId.socket2 ?? 0) + (byId.socket4 ?? 0) + (byId.socket_app ?? 0);
  const switchCount = (byId.switch1 ?? 0) + (byId.switch2 ?? 0);
  const wayCount = byId.switch_way ?? 0;
  const way2Count = byId.switch2_way ?? 0;
  const boxes = socketCount + switchCount + wayCount + way2Count;

  return [
    {
      group: 'Electrics', name: 'Cable VVGng-LS 3×2.5', price: 'cable_25',
      qty: cable.power * 1.1, unit: 'm', note: 'power groups, with a 10 % allowance'
    },
    {
      group: 'Electrics', name: 'Cable VVGng-LS 3×1.5', price: 'cable_15',
      qty: cable.light * 1.1, unit: 'm', note: 'lighting, with a 10 % allowance'
    },
    {
      group: 'Electrics', name: 'Conduit', price: 'conduit',
      qty: electrical.inFloorM * 1.1, unit: 'm',
      note: 'ONLY in the screed. Lighting runs openly along the slab, no conduit there'
    },
    {
      group: 'Electrics', name: 'Back box', price: 'back_box',
      qty: boxes, unit: 'pcs', note: 'for every socket and switch'
    },
    {
      group: 'Electrics', name: 'Junction box', price: 'junction_box',
      qty: Math.max(4, Math.ceil(boxes / 4)), unit: 'pcs', note: 'per room'
    },
    {
      group: 'Electrics', name: 'Socket with frame', price: 'socket',
      qty: socketCount, unit: 'pcs', note: `${byId.socket4 ?? 0} of them 4-gang blocks`
    },
    {
      group: 'Electrics', name: 'Socket IP44', price: 'socket_ip44',
      qty: byId.socket_ip44 ?? 0, unit: 'pcs', note: 'bathroom'
    },
    {
      group: 'Electrics', name: 'Switch', price: 'switch',
      qty: switchCount, unit: 'pcs', note: `${byId.switch2 ?? 0} two-gang`
    },
    {
      group: 'Electrics', name: 'Two-way switch', price: 'switch_way',
      qty: wayCount + 1, unit: 'pcs', note: 'stair lighting, plus its pair in the attic'
    },
    {
      group: 'Electrics', name: 'Two-gang two-way switch', price: 'switch2_way',
      qty: way2Count, unit: 'pcs',
      note: 'living room in two groups from two places. Between the pair itself FOUR ' +
        'strapping cores plus earth are needed: either 5×1.5, or two cables 3×1.5'
    },
    {
      group: 'Electrics', name: 'Modular breaker', price: 'breaker',
      qty: electrical.breakers, unit: 'pcs',
      note: electrical.byCircuit
        .map((g) => `${g.label} ${g.breaker} A`)
        .join(', ')
    },
    {
      group: 'Electrics', name: 'RCD / RCBO', price: 'rcd',
      qty: electrical.byCircuit.filter((g) => g.rcd).length, unit: 'pcs',
      note: 'on all socket groups; bathroom with washing machine — 10 mA, the rest 30'
    },
    {
      group: 'Electrics', name: 'Internal board', price: 'panel_box',
      qty: 1, unit: 'pcs', note: 'the main board is outside, this one is for distribution'
    },
    {
      group: 'Lighting', name: 'Surface-mounted luminaire with shade', price: 'light_plafond',
      qty: byId.light ?? 0, unit: 'pcs', note: 'general light, 110° angle'
    },
    {
      group: 'Lighting', name: 'Adjustable spot', price: 'light_spot',
      qty: byId.light_work ?? 0, unit: 'pcs', note: 'kitchen task light, 30° angle'
    },
    {
      group: 'Lighting', name: 'Pendant over the worktop', price: 'light_pendant',
      qty: byId.light_pendant ?? 0, unit: 'pcs', note: '750–800 above the worktop'
    }
  ].filter((i) => i.qty > 0);
}

// Лестница на двух стальных косоурах. Всё считается из геометрии марша:
// поменяли ширину или проекцию — пересчитался металл, крепёж и зашивка.
export const STAIR_STEEL = {
  // Профтруба 120×60×4 выбрана по ПРОГИБУ, а не по прочности.
  // Прочности хватало и 100×50×3 (W = 20,6 против нужных 14,1 см³),
  // но прогиб выходил 26 мм — лестница пружинила бы под ногой.
  // При I = 219 см⁴ прогиб 15,6 мм, то есть L/295. Это уже спокойно.
  stringer: { label: '120×60×4', Ix: 219, Wx: 41, kgPerM: 10.3 },
  // Площадки под ступени: два отрезка уголка на каждую ступень
  platformLen: 0.25,
  boltsPerTread: 4
};

export function stairItems(stair) {
  if (!stair) return [];

  const f = stairFabrication(stair);
  const run = stair.length; // projection, m
  const rise = stair.totalRise; // rise, m
  const steps = f.treads;
  const width = stair.width;
  const slope = f.stringers.cutLen / 1000; // flight length along the handrail

  // Зашивка сбоку: треугольник от нижней ступени до грани санузла
  const boxRun = Math.min(run, 2.6);
  const boxHeight = boxRun * (rise / run);
  const boxArea = (boxRun * boxHeight) / 2 + width * boxHeight * 0.5;

  return [
    {
      group: 'Stair', name: `Rectangular tube ${f.stringers.label} — stringers`,
      price: 'tube_120x60', qty: f.stockBars * 6, unit: 'm',
      note: `cut ${f.stringers.cutLen.toFixed(0)} mm × ${f.stringers.count} = ` +
        `${f.stringers.totalM.toFixed(2)} m from ${f.stockBars} bars of 6 m. ` +
        'Section chosen by DEFLECTION: L/295, not by strength'
    },
    {
      group: 'Stair', name: `Angle ${f.platforms.label} — tread supports`,
      price: 'angle_63', qty: f.platforms.totalM * 1.1, unit: 'm',
      note: `${f.platforms.count} pieces of ${f.platforms.len} mm, two per step`
    },
    {
      group: 'Stair', name: 'Sheet 4 mm — triangular gussets',
      price: 'steel_sheet4', qty: f.gusset.areaM2 * 1.25 + 0.11, unit: 'm²',
      note: `${f.gusset.count} triangles ${f.gusset.base.toFixed(0)} × ` +
        `${f.gusset.height.toFixed(0)} (legs = tread and riser), ` +
        `${f.gusset.massKg.toFixed(0)} kg. Plus the heels and top plates`
    },
    {
      group: 'Stair', name: 'Embed plate for the stringer heel 250×120×6',
      price: 'embed_stair', qty: f.stringers.count, unit: 'pcs',
      note: 'the tube is cut HORIZONTALLY and welded around the whole cut. ' +
        'FIT BEFORE THE POUR: you cannot drill into a screed with a heating pipe'
    },
    {
      group: 'Stair', name: 'Through bolt M12 — top connection',
      price: 'bolt_m12', qty: 6, unit: 'pcs',
      note: 'the slab is WOODEN — a through bolt with a wide washer, not an anchor. ' +
        'The connection depends on the opening beam: joist direction and bearing are NOT MEASURED'
    },
    {
      group: 'Stair', name: 'Metal primer-enamel',
      price: 'metal_paint', qty: 1.5, unit: 'l',
      note: 'two coats over the whole frame, including hidden faces'
    },
    {
      group: 'Stair', name: 'Bolt M8×60 with nut and washers',
      price: 'bolt_m8', qty: steps * STAIR_STEEL.boltsPerTread, unit: 'pcs',
      note: `${STAIR_STEEL.boltsPerTread} per step, from below through the angle into the tread`
    },
    {
      group: 'Stair', name: 'Rubber gasket under the step',
      price: 'rubber_pad', qty: steps * STAIR_STEEL.boltsPerTread, unit: 'pcs',
      note: 'MAIN protection against squeaks and impact noise: wood does not touch steel'
    },
    {
      group: 'Stair', name: 'Wood glue D3 — gluing up the treads',
      price: 'wood_glue', qty: 1.5, unit: 'kg',
      note: 'the floor board is reused, but cut off the tongue and joint the edges'
    },
    {
      group: 'Stair', name: 'Plywood 3 mm on the tread face',
      price: 'ply3', qty: steps * width * 0.28 * 1.2, unit: 'm²',
      note: 'do NOT take it to the front nosing: it will peel off under feet'
    },
    {
      group: 'Stair', name: 'Plywood 12 mm — risers',
      price: 'ply12', qty: steps * width * 0.2 * 1.15, unit: 'm²',
      note: 'they close the pantry from dust and from view through the steps'
    },
    {
      group: 'Stair', name: 'Wood oil or varnish',
      price: 'wood_oil', qty: 1.5, unit: 'l',
      note: 'matt with an anti-slip additive — varnish is slippery'
    },
    {
      group: 'Stair', name: 'Plasterboard 12.5 — side cladding and pantry',
      price: 'gkl', qty: boxArea * 1.2, unit: 'm²',
      note: 'side wall of the flight and the pantry front'
    },
    {
      group: 'Stair', name: 'Cladding frame profile',
      price: 'gkl_frame', qty: boxArea * 3, unit: 'm',
      note: 'battens for plasterboard along the stringer'
    },
    {
      group: 'Stair', name: 'Pantry door under the flight',
      price: 'cupboard_door', qty: 2, unit: 'pcs',
      note: 'access to the washing machine and storage'
    },
    {
      group: 'Stair', name: 'Wooden handrail',
      price: 'handrail', qty: slope * 1.1, unit: 'm',
      note: 'the flight is closed on both sides, so balusters are not needed — only a handrail'
    },
    {
      group: 'Stair', name: 'Handrail bracket',
      price: 'handrail_bracket', qty: 4, unit: 'pcs',
      note: 'pitch no more than 1.2 m'
    }
  ];
}

// Щиты: ввод, распределение и бесперебойник. Считается из calc/panel.js,
// поэтому состав не может разойтись со схемой.
function panelItems(plan) {
  if (!plan) return [];

  // Аппараты считаются ПО ФАКТУ состава щита, а не одной строкой «дифавтоматы»:
  // санузлу нужно 10 мА, и стоит он заметно дороже тридцати.
  const groups = plan.indoor.devices.filter((d) => d.circuit);
  const rcbo30 = groups.filter((d) => d.rcdMa === 30 && d.rating === 16);
  const rcbo10 = groups.filter((d) => d.rcdMa === 10);
  const rcboSmall = groups.filter((d) => d.rcdMa === 30 && d.rating < 16);
  const plain = groups.filter((d) => !d.rcdMa);

  const rows = [
    {
      group: 'Boards', name: 'Board for 24 modules, internal', price: 'panel_24',
      qty: 1, unit: 'pcs',
      note: `used ${plan.indoor.used}, free ${plan.indoor.free}. The whole grouping ` +
        'moves from outside to inside: electronic RCBOs work down to −25 °C, ' +
        'and the design outdoor temperature is −27'
    },
    {
      group: 'Boards', name: 'Load switch 2P 40 A', price: 'isolator_2p',
      qty: 1, unit: 'pcs', note: 'board feed: de-energise the house without going outside'
    },
    {
      group: 'Boards', name: 'RCBO C16 / 30 mA', price: 'rcbo_30ma',
      qty: rcbo30.length, unit: 'pcs',
      note: rcbo30.map((d) => d.label.split(' — ')[0]).join(', ') +
        '. One per group, not a common RCD for all: the house stands empty for long periods, ' +
        'and “one tripped — everything went dark” costs more than the price difference'
    },
    {
      group: 'Boards', name: 'RCBO C16 / 10 mA', price: 'rcbo_10ma',
      qty: rcbo10.length, unit: 'pcs',
      note: 'bathroom and washing machine — a wet zone, 10 mA there, not the common 30'
    },
    {
      group: 'Boards', name: 'RCBO C6 / 30 mA', price: 'rcbo_30ma',
      qty: rcboSmall.length, unit: 'pcs',
      note: 'boiler through the UPS. Rated 6 A because behind it there is only 130 W'
    },
    {
      group: 'Boards', name: 'Breaker C10 for lighting', price: 'breaker',
      qty: plain.length, unit: 'pcs',
      note: 'no RCD on purpose: if the sockets fault, the light stays on, ' +
        'and in an empty house that matters more'
    },
    {
      group: 'Boards', name: 'Voltage relay with auto-reset', price: 'voltage_relay',
      qty: 1, unit: 'pcs',
      note: 'REPLACES the RMM47 in the outdoor board. That one trips the breaker and leaves it ' +
        'off until it is re-armed by hand. NOT urgent to replace: done in the same ' +
        'visit as assembling the board'
    },
    {
      group: 'Boards', name: 'RCD 2P 63 A / 300 mA type S', price: 'rcd_300s',
      qty: 1, unit: 'pcs',
      note: 'BUY ADDITIONALLY for the outdoor board. Type S is mandatory: without a time delay it ' +
        'would trip together with the 30 mA group devices. Takes three modules ' +
        'freed by the removed group devices'
    },
    {
      group: 'Boards', name: 'Cable VVGng-LS 3×6 from the outdoor board', price: 'cable_6',
      qty: 10, unit: 'm', note: 'feed into the house, to the board in the hall'
    },
    {
      group: 'Boards', name: 'UPS Shtil SW500L 500 VA / 400 W', price: 'ups_sw500l',
      qty: 1, unit: 'pcs',
      note: 'online, pure sine wave, 5 A charger, 24 V bus. The output is ONE ' +
        'Schuko socket, hence the board after it. Indoors only: from +5 °C'
    },
    {
      group: 'Boards', name: 'AGM battery 12 V 100 Ah', price: 'agm_100',
      qty: 2, unit: 'pcs',
      note: 'two in series on the 24 V bus. Amp-hours do NOT double: ' +
        'the bank stays 100 Ah. Run time 12.9 h, recharge 24 h'
    },
    {
      group: 'Boards', name: 'Battery rack standing on the screed', price: 'battery_rack',
      qty: 1, unit: 'pcs',
      note: 'the niche under the hall window 900 × 1100. Rest it on the screed, do not hang ' +
        'it on aerated concrete: 60 kg. Gap from the floor — there is underfloor heating under the batteries, ' +
        'and AGM life halves for every +10 °C'
    }
  ];
  return rows.filter((r) => r.qty > 0);
}

// Аварийное питание. Всё, что стоит ПОСЛЕ ИБП, плюс автономный свет,
// который к ИБП вообще не относится. Сам ИБП и батареи сюда не входят:
// модель не выбрана, а придумывать цену за заказчика нельзя.
function emergencyItems(ep) {
  if (!ep) return [];
  return [
    {
      group: 'Emergency power', name: 'DIN enclosure for 8 modules', price: 'panel_din8',
      qty: 1, unit: 'pcs',
      note: `the UPS has ONE Schuko socket at the output, but ${ep.branches.length} branches. ` +
        `${ep.modulesUsed} modules used, ${ep.modulesFree} spare`
    },
    {
      group: 'Emergency power', name: 'Breaker 6 A per branch', price: 'breaker',
      qty: ep.branches.filter((b) => !b.rcd).length, unit: 'pcs',
      note: 'boiler, router, boiler-room light — each its own, so that a fault ' +
        'in one branch does not reach the others'
    },
    {
      group: 'Emergency power', name: `Breaker B${ep.socket.rating} A for the socket`,
      price: 'breaker_b1', qty: 1, unit: 'pcs',
      note: `chosen NOT by the cable but by what is left of the inverter: ${ep.socket.spareW} W = ` +
        `${ep.socket.spareA.toFixed(2)} A. Lets a charger and a laptop through, cuts off a kettle ` +
        'instantly. Characteristic B, not C'
    },
    {
      group: 'Emergency power', name: 'RCBO 10 mA for the socket', price: 'rcbo_10ma',
      qty: 1, unit: 'pcs',
      note: 'the only branch with unknown content — it catches a leakage ' +
        'itself without disturbing the common boiler RCD'
    },
    {
      group: 'Emergency power', name: 'Class II luminaire above the boiler',
      price: 'light_classii', qty: 1, unit: 'pcs',
      note: 'no earthed parts — it cannot produce an earth leakage'
    },
    {
      group: 'Emergency power', name: 'Marked emergency socket',
      price: 'socket_marked', qty: 1, unit: 'pcs',
      note: 'a distinct colour and label: not for a kettle'
    },
    {
      group: 'Emergency power', name: 'Cable VVGng-LS 3×1.5 for the branches',
      price: 'cable_15', qty: 18, unit: 'm',
      note: 'board → boiler-room light, → emergency socket in the living room, with an allowance'
    },
    {
      group: 'Emergency power', name: 'Luminaire with battery backup', price: 'light_bap',
      qty: 3, unit: 'pcs',
      note: 'stair, living room and attic landing. NOT from the UPS: own battery, ' +
        'ordinary lighting line, comes on by itself. No cable across the house is needed'
    }
  ];
}

// Слаботочка. Отдельной группой, потому что живёт по своим правилам:
// в стяжку не идёт, автоматов не занимает, и половина её — задел на будущее.
function lowVoltageItems(lv) {
  if (!lv) return [];
  const utp = lv.utpM * 1.05;
  return [
    {
      group: 'Low-voltage', name: 'UTP cat.6 cable, copper', price: 'utp_cat6',
      qty: utp, unit: 'm',
      note: `${lv.utpLinks} links: set-top box, TV, attic access point, ` +
        'front door. ONLY copper — copper-clad aluminium does not carry PoE and breaks'
    },
    {
      group: 'Low-voltage', name: 'Conduit Ø20 with pull cord', price: 'conduit20',
      qty: lv.conduitM, unit: 'm',
      note: 'along the slab, NOT in the screed. The conduit here is not about fire but about being able ' +
        'to re-pull the cable in ten years without opening up the house'
    },
    {
      group: 'Low-voltage', name: 'Double RJ45 socket', price: 'rj45_socket',
      qty: 1, unit: 'pcs', note: 'behind the TV: set-top box and the TV itself'
    },
    {
      group: 'Low-voltage', name: 'RJ45 module / connector', price: 'rj45_keystone',
      qty: lv.utpLinks * 2, unit: 'pcs', note: 'two per link, one at each end'
    },
    {
      group: 'Low-voltage', name: 'Patch cord', price: 'patch_cord',
      qty: 4, unit: 'pcs', note: 'router — sockets, set-top box — socket'
    },
    {
      group: 'Low-voltage', name: 'Speaker cable 2×2.5', price: 'speaker_cable',
      qty: 16, unit: 'm',
      note: 'PROVISION for stereo: two speakers either side of the TV, ' +
        'in conduit inside the flight boxing. Pull before the plasterboard is closed'
    }
  ];
}

// Бетонная столешница на стальном каркасе по закладным.
// Объёмы выводятся из фронта, а не задаются руками: двинули посудомойку —
// пересчиталось всё, включая число стоек.
function worktopItems(worktop, screed) {
  if (!worktop) return [];
  const f = worktopFabrication(worktop, screed);
  const massKg = f.slabMassKg;

  return [
    {
      group: 'Worktop', name: 'Mix and reinforcement for the pour', price: 'worktop_concrete',
      qty: worktop.area, unit: 'm²',
      note: `${f.slabT.toFixed(0)} mm on a steel frame, slab mass ≈ ${massKg.toFixed(0)} kg, ` +
        `${f.loadPerPostKg.toFixed(0)} kg per post`
    },
    {
      group: 'Worktop', name: `Angle ${f.angle.label} — frame and posts`,
      price: 'worktop_frame', qty: f.angleTotalM * 1.08, unit: 'm',
      note: `longitudinal ${f.longitudinalM.toFixed(1)} + cross members ${f.crossM.toFixed(1)} + ` +
        `posts ${f.postM.toFixed(1)}. ${f.frontPosts} at the front at a pitch of ${f.framePitch} ` +
        `and ${f.backPosts} at the back at a pitch of ${f.backPitch}, all ${f.postLen.toFixed(0)} mm long`
    },
    {
      group: 'Worktop', name: 'Embed plate for the worktop posts',
      price: 'embed_plate', qty: 16, unit: 'pcs',
      note: `${f.embed.count} needed (${f.frontPosts} at the front + ${f.backPosts} at the back), ` +
        'we take 16 WITH A SURPLUS: an embed costs 275 ₽, and the choice of rear support ' +
        'can be postponed — it is placed BEFORE THE POUR, the decision is taken later'
    },
    {
      group: 'Worktop', name: 'Post cladding, chipboard', price: 'worktop_post',
      qty: f.posts, unit: 'pcs',
      note: 'posts stand on the joints of the sections, where the cabinet sides meet'
    },
    {
      group: 'Worktop', name: 'Concrete sealer', price: 'worktop_seal',
      qty: Math.max(1, worktop.area / 8), unit: 'l',
      note: 'unsealed concrete in a kitchen takes wine and oil stains irreversibly'
    }
  ];
}

// Обвязка котельной. Здесь только то, чего НЕТ внутри котла:
// насос, расширительный бак и группа безопасности встроены, и половина
// типовых схем из интернета дублирует их зря.
function boilerRoomItems(plan, coolant) {
  if (!plan) return [];

  const items = [
    {
      group: 'Boiler room', name: 'Ball valve 3/4" with union', price: 'ball_valve_20',
      qty: 4, unit: 'pcs',
      note: '2 for the boiler + 2 for the manifold: any unit can be removed without draining the system'
    },
    {
      group: 'Boiler room', name: 'Y-strainer 3/4"', price: 'strainer_20',
      qty: 1, unit: 'pcs',
      note: 'on the RETURN before the boiler. The screed is new — there will be a lot of scale and debris'
    },
    {
      group: 'Boiler room', name: 'Strap-on thermometer 0–80 °C', price: 'thermometer',
      qty: 2, unit: 'pcs',
      note: 'manifold supply and return. The difference shows whether the loop works'
    },
    {
      group: 'Boiler room', name: 'Strap-on emergency thermostat, 55 °C', price: 'safety_stat',
      qty: 1, unit: 'pcs',
      note: 'the SECOND screed protection: with a direct connection there is nothing between ' +
        'the boiler and the concrete except the F06 parameter'
    },
    {
      group: 'Boiler room', name: 'Outdoor temperature sensor', price: 'outdoor_sensor',
      qty: 1, unit: 'pcs',
      note: 'without it the weather-compensated Kt curve does not work at all'
    },
    {
      group: 'Boiler room', name: 'Feed pipe 3/4" with fittings', price: 'pipe_20',
      qty: 3, unit: 'm',
      note: `boiler — manifold, 700 mm along the wall; velocity ${plan.connection.velocity.toFixed(2)} m/s`
    }
  ];

  // Подпитка. С ядовитым гликолем связь с водопроводом недопустима,
  // и вода вдобавок разбавляет состав — значит подпитка только ручная.
  if (plan.toxic) {
    items.push({
      group: 'Boiler room', name: 'Manual pressure-test pump with tank', price: 'test_pump',
      qty: 1, unit: 'pcs',
      note: 'broken-line make-up with READY-MIXED fluid. Plug the built-in DHW fill valve'
    });
  }

  // Замена просроченного теплоносителя. Считаем только первый этаж —
  // объём мансардного контура неизвестен, он добавится сверху.
  const conc = coolant?.dilution?.find((d) => d.freeze <= -30) ?? coolant?.dilution?.[1];
  if (conc && coolant?.expired !== false) {
    const litres = plan.volume.totalL * (conc.concentrate / 100);
    items.push({
      group: 'Boiler room', name: 'Antifreeze concentrate for replacement', price: 'coolant_conc',
      qty: litres, unit: 'l',
      note: `${conc.concentrate} % concentrate to ${conc.water} % water = ${conc.freeze} °C. ` +
        `Ground-floor system ${plan.volume.totalL.toFixed(0)} l; the attic circuit comes on top`
    });
  }

  return items;
}

export function floorEstimate({
  layout, screed, levels, loops, coolant, electrical, stair, boilerRoom, equipment,
  lowVoltage, emergency, panel
}) {
  const rooms = buildRooms(layout);
  const area = rooms.reduce((s, r) => s + polygonArea(r.polygon), 0);

  // Периметр наружных стен изнутри + суммарная длина перегородок:
  // по ним идёт демпферная лента
  const walls = buildWalls(layout);
  const outerPerimeter = 2 * (INNER_W + INNER_D);
  const partitions = walls
    .filter((w) => w.kind === 'partition')
    .reduce((s, w) => s + wallVector(w).len, 0);
  const damperLength = outerPerimeter + partitions;

  // Засыпка и подготовка
  const sandInPlace = (levels.sandFill / 1000) * area;
  const gravelInPlace = (screed.gravel / 1000) * area;

  // Стяжка за вычетом объёма трубы
  const pipeMetres = loops.totalPipe * WASTE.pipe;
  const pipeVolume = loops.totalPipe * Math.PI * (screed.pipeOd / 2000) ** 2;
  const screedVolume = (screed.screedTotal / 1000) * area - pipeVolume;
  const cementKg = screedVolume * RATES.cementPerM3;

  // Утепление торца плиты по внутренней грани фундамента.
  // Профиль ступенчатый: толстый ЭППС только НИЖЕ стяжки, на её высоте —
  // демпферная лента. Поэтому площадь плиты считается не на всю глубину.
  const screedBandMm = screed.screedTotal + screed.finishThickness;
  const edgeArea = levels.edgeInsulation > 0
    ? ((levels.edgeInsulationDepth - screedBandMm) / 1000) * outerPerimeter
    : 0;

  const items = [
    {
      group: 'Base',
      name: 'Sand for filling the sub-floor',
      price: 'sand_fill',
      qty: sandInPlace * WASTE.sandCompaction,
      unit: 'm³',
      note: `${levels.sandFill} mm compacted, ${up(levels.sandFill / levels.compactLayer)} layers`
    },
    {
      group: 'Base',
      name: 'Crushed stone 20–40',
      price: 'gravel',
      qty: gravelInPlace * WASTE.gravelCompaction,
      unit: 'm³',
      note: `${screed.gravel} mm of bedding`
    },
    {
      group: 'Base',
      name: 'Washed sand for the levelling bed',
      price: 'sand_washed',
      qty: ((screed.sandBed ?? 0) / 1000) * area * WASTE.sandCompaction,
      unit: 'm³',
      note: `${screed.sandBed ?? 0} mm on top of the crushed stone — protects the film from sharp edges`
    },
    {
      group: 'Base',
      name: 'Waterproofing film 200 µm',
      price: 'film',
      qty: area * WASTE.waterproofing,
      unit: 'm²',
      note: 'with overlaps and turned up onto the walls'
    },
    {
      group: 'Insulation',
      name: `XPS ${screed.insulation - screed.insulationReused} mm boards`,
      price: 'xps_field',
      qty: area * WASTE.insulation,
      unit: 'm²',
      note: `≈ ${up((area * WASTE.insulation) / RATES.insulationSheet)} boards 1180 × 580`
    },
    {
      group: 'Insulation',
      name: `XPS ${levels.edgeInsulation || 80} mm on the slab edge`,
      price: 'xps_edge',
      qty: edgeArea || (0.5 * outerPerimeter),
      unit: 'm²',
      note: `a strip of ${(levels.edgeInsulationDepth - screedBandMm).toFixed(0)} mm ` +
        `from the screed bottom down, on the inner face of the foundation, BEFORE the fill. ` +
        `Above — only the strip: 100 mm of board at the finished floor would take a strip off the room`
    },
    {
      group: 'Insulation',
      name: 'Foam adhesive for XPS',
      price: 'foam_glue',
      qty: Math.max(3, (edgeArea || 11) / 4),
      unit: 'cyl.',
      note: 'fixing the edge boards to the foundation'
    },
    {
      group: 'Insulation',
      name: `Damper strip ${levels.edgeStrip ?? 10} mm, height 100`,
      price: 'damper_tape',
      qty: damperLength * 1.1,
      unit: 'm',
      note: 'around the perimeter and along all partitions. It is also the upper step ' +
        'of the edge break: trimmed AFTER the porcelain tile is laid, goes under the skirting board'
    },
    {
      group: 'Underfloor heating',
      name: `Cross-linked polyethylene pipe ${screed.pipeOd} × 2.0`,
      price: 'pex16',
      qty: pipeMetres,
      unit: 'm',
      note: 'every loop is ONE PIECE with no joints in the screed'
    },
    {
      group: 'Underfloor heating',
      name: 'Welded mesh 100 × 100 × 4',
      price: 'mesh',
      qty: area * WASTE.mesh,
      unit: 'm²',
      note: `≈ ${up((area * WASTE.mesh) / RATES.meshSheet)} sheets 2 × 3 m. ` +
        'The cell is chosen as reinforcement, not to suit the pipe pitch: the pipe is tied ' +
        'to the cross bars and lies at any pitch'
    },
    {
      group: 'Underfloor heating',
      name: 'Nylon ties 200 mm',
      price: 'ties',
      qty: pipeMetres * RATES.tiesPerMetre,
      unit: 'pcs',
      note: 'fixing the pipe to the mesh, not with harpoon staples'
    },
    {
      group: 'Underfloor heating',
      name: `Manifold for ${loops.totalLoops} loops`,
      price: 'manifold',
      qty: 1,
      unit: 'set',
      note: 'with flow meters and balancing valves — the length imbalance is large'
    },
    {
      group: 'Underfloor heating',
      name: 'Euroconus 16 mm',
      price: 'eurocone',
      qty: loops.totalLoops * 2,
      unit: 'pcs',
      note: 'supply and return for every loop'
    },
    {
      group: 'Underfloor heating',
      name: 'Manifold cabinet',
      price: 'manifold_box',
      qty: 1,
      unit: 'pcs',
      note: 'built-in, in the hall'
    },
    // Циркуляционный насос ИСКЛЮЧЁН: паспортный график насоса котла дал
    // 4,81 м при 345 л/ч, располагаемый 4,21 против требуемых 1,19 —
    // кратность 3,5. Паспорт вдобавок требует ставить дополнительный насос
    // только после гидроразделителя, которого в схеме нет.
    // Аварийный термостат переехал в группу «Котельная» — он часть цепи
    // защиты котла, а не раскладки петель.
    {
      group: 'Screed',
      name: 'Cement M500',
      price: 'cement',
      qty: cementKg,
      unit: 'kg',
      note: `≈ ${up(cementKg / RATES.bagCement)} bags of ${RATES.bagCement} kg`
    },
    {
      group: 'Screed',
      name: 'Washed sand for the mortar',
      price: 'sand_washed',
      qty: screedVolume * RATES.sandPerM3,
      unit: 'm³',
      note: 'mortar M300'
    },
    {
      group: 'Screed',
      name: 'Polypropylene fibre 12 mm',
      price: 'fibre',
      qty: screedVolume * RATES.fibrePerM3,
      unit: 'kg',
      note: 'against shrinkage cracks'
    },
    {
      group: 'Screed',
      name: 'Plasticiser for underfloor heating',
      price: 'plasticiser',
      qty: cementKg * RATES.plasticiserPerCement,
      unit: 'l',
      note: 'mandatory: a screed over a pipe'
    },
    {
      group: 'Screed',
      name: 'Expansion joint profile',
      price: 'joint_profile',
      qty: damperLength * 0.3,
      unit: 'm',
      note: 'in openings and along zone boundaries'
    }
  ];

  const all = [
    ...items,
    ...electricalItems(electrical),
    ...stairItems(stair),
    ...boilerRoomItems(boilerRoom, coolant),
    ...worktopItems(equipment ? buildWorktop(layout, equipment) : null, screed),
    ...lowVoltageItems(lowVoltage),
    ...emergencyItems(emergency),
    ...panelItems(panel)
  ];

  // Стоимость по трём границам. Позиция без цены в прайсе честно помечается
  // как непосчитанная, а не считается нулём в итоге.
  const priced = all.map((i) => ({
    ...i,
    cost: lineCost(i.qty, i.price),
    pack: packOf(i.price, i.qty)
  }));

  const totals = priced.reduce(
    (t, i) => {
      t.min += i.cost.min;
      t.avg += i.cost.avg;
      t.max += i.cost.max;
      if (!i.cost.priced) t.unpriced.push(i.name);
      return t;
    },
    { min: 0, avg: 0, max: 0, unpriced: [] }
  );

  const groups = [...new Set(priced.map((i) => i.group))];
  const byGroup = groups.map((g) => {
    const rows = priced.filter((i) => i.group === g);
    return {
      group: g,
      rows,
      min: rows.reduce((s, i) => s + i.cost.min, 0),
      avg: rows.reduce((s, i) => s + i.cost.avg, 0),
      max: rows.reduce((s, i) => s + i.cost.max, 0)
    };
  });

  return {
    area,
    outerPerimeter,
    damperLength,
    screedVolume,
    screedMassKg: screedVolume * RATES.screedDensity,
    pipeMetres,
    items: priced,
    groups,
    byGroup,
    totals,
    meta: PRICEBOOK_META
  };
}

// Как нарезать трубу из бухт, чтобы каждая петля была цельной.
// Жадный алгоритм: кладём самые длинные петли первыми.
export function pipeCutting(loopLengths, coilSizes = [200, 100, 50]) {
  const need = [...loopLengths].sort((a, b) => b - a);
  const coils = [];

  need.forEach((len) => {
    const fit = coils.find((c) => c.left >= len);
    if (fit) {
      fit.left -= len;
      fit.cuts.push(len);
    } else {
      const size = coilSizes.find((s) => s >= len) ?? coilSizes[0];
      coils.push({ size, left: size - len, cuts: [len] });
    }
  });

  // Ужимаем каждую бухту до наименьшего размера, в который влезли её куски:
  // раскладку вели по самой большой, но покупать столько не обязательно.
  const sizes = [...coilSizes].sort((a, b) => a - b);
  const fitted = coils.map((c) => {
    const used = c.cuts.reduce((s, v) => s + v, 0);
    const size = sizes.find((s) => s >= used) ?? c.size;
    return { size, cuts: c.cuts, left: size - used };
  });

  return {
    coils: fitted,
    totalOrdered: fitted.reduce((s, c) => s + c.size, 0),
    waste: fitted.reduce((s, c) => s + c.left, 0)
  };
}

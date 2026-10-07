import React from 'react';

// Piping diagram of the boiler room.
//
// The diagram is TOPOLOGICAL: it shows what connects to what and in which order,
// not where things hang on the wall. Wall positions are on the plan.
//
// The dashed outline marks what is BUILT INTO THE BOILER. This is the main thing the diagram
// has to tell the installer: the pump, vessel, safety group and air vent
// are already bought with the boiler, a second set is not needed.

const RED = '#dc2626';
const BLUE = '#2563eb';
const INK = '#0f172a';
const MUTED = '#64748b';
const WARN = '#b45309';

function Valve({ x, y, label, color = INK }) {
  // Ball valve symbol — two opposed triangular cavities
  return (
    <g>
      <path d={`M${x - 7} ${y - 7} L${x - 7} ${y + 7} L${x} ${y} Z`} fill={color} />
      <path d={`M${x + 7} ${y - 7} L${x + 7} ${y + 7} L${x} ${y} Z`} fill={color} />
      {label && (
        <text x={x} y={y - 12} textAnchor="middle" fontSize="12" fill={MUTED}>{label}</text>
      )}
    </g>
  );
}

function Strainer({ x, y, label }) {
  return (
    <g>
      <rect x={x - 9} y={y - 8} width="18" height="16" fill="#fff" stroke={INK} strokeWidth="1.4" />
      <path d={`M${x - 9} ${y + 8} L${x + 9} ${y - 8}`} stroke={INK} strokeWidth="1.2" />
      <path d={`M${x - 4} ${y + 8} L${x + 9} ${y - 2}`} stroke={INK} strokeWidth="0.8" />
      {label && (
        <text x={x} y={y + 22} textAnchor="middle" fontSize="12" fill={MUTED}>{label}</text>
      )}
    </g>
  );
}

function Gauge({ x, y, label, color = INK }) {
  return (
    <g>
      <circle cx={x} cy={y} r="9" fill="#fff" stroke={color} strokeWidth="1.4" />
      <path d={`M${x} ${y} L${x + 5} ${y - 5}`} stroke={color} strokeWidth="1.2" />
      {label && (
        <text x={x} y={y - 14} textAnchor="middle" fontSize="12" fill={MUTED}>{label}</text>
      )}
    </g>
  );
}

export default function BoilerScheme({ plan, boiler, loops }) {
  const W = 1000;
  const H = 540;

  const ySup = 134; // supply
  const yRet = 336; // return

  const boilerBox = { x: 26, y: 66, w: 232, h: 336 };
  const manX = 700; // left face of the manifold
  const manW = 200;

  const loopCount = loops?.totalLoops ?? 4;
  const loopNames = (loops?.byRoom ?? []).flatMap((r) =>
    Array.from({ length: r.loops }, (_, i) =>
      r.loops > 1 ? `${r.name} ${i + 1}` : r.name
    )
  );

  const exp = plan?.expansion;
  const conn = plan?.connection;

  return (
    <svg className="boiler-scheme" viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label="Piping diagram of the boiler room">

      {/* ---------- Boiler: everything inside the dashed line is already bought ---------- */}
      <rect x={boilerBox.x} y={boilerBox.y} width={boilerBox.w} height={boilerBox.h}
        rx="8" fill="#f8fafc" stroke={INK} strokeWidth="1.6" strokeDasharray="7 4" />
      <text x={boilerBox.x + boilerBox.w / 2} y={boilerBox.y - 28} textAnchor="middle"
        fontSize="17" fontWeight="700" fill={INK}>
        {boiler?.model ?? 'Boiler'}
      </text>
      <text x={boilerBox.x + boilerBox.w / 2} y={boilerBox.y - 8} textAnchor="middle"
        fontSize="12.5" fill={MUTED}>
        built in — no need to buy
      </text>

      {[
        ['Pump', 'margin ×3.5'],
        [`Vessel ${boiler?.expansionVesselL ?? 8} l`, exp ? `need ${exp.requiredL.toFixed(1)} l` : ''],
        ['3 bar valve', 'safety group'],
        ['Air vent', 'automatic'],
        ['Pressure gauge', 'on the panel'],
        ['DHW diverter', 'dual-circuit']
      ].map(([name, sub], i) => (
        <g key={name}>
          <rect x={boilerBox.x + 14} y={boilerBox.y + 24 + i * 52} width={boilerBox.w - 28} height="40"
            rx="4" fill="#fff" stroke="#cbd5e1" strokeWidth="1" />
          <text x={boilerBox.x + 24} y={boilerBox.y + 49 + i * 52} fontSize="13.5" fontWeight="600" fill={INK}>{name}</text>
          <text x={boilerBox.x + boilerBox.w - 24} y={boilerBox.y + 49 + i * 52} textAnchor="end"
            fontSize="11.5" fill={MUTED}>{sub}</text>
        </g>
      ))}

      {/* ---------- Supply ---------- */}
      <path d={`M${boilerBox.x + boilerBox.w} ${ySup} H${manX}`} stroke={RED} strokeWidth="4" fill="none" />
      <polygon points={`${manX - 26},${ySup - 5} ${manX - 14},${ySup} ${manX - 26},${ySup + 5}`} fill={RED} />
      <text x={boilerBox.x + boilerBox.w + 10} y={ySup - 36} fontSize="14.5" fontWeight="700" fill={RED}>
        Supply 45 °C
      </text>
      <text x={boilerBox.x + boilerBox.w + 10} y={ySup - 17} fontSize="12" fill={MUTED}>
        F06 = 001, cut-off 50
      </text>

      <Valve x={272} y={ySup} label="valve" color={RED} />
      <Gauge x={330} y={ySup} label="thermometer" color={RED} />

      {/* Emergency thermostat — the second line of screed protection */}
      <rect x={400} y={ySup - 15} width="30" height="30" rx="4" fill="#fff" stroke={WARN} strokeWidth="1.8" />
      <text x={415} y={ySup + 4} textAnchor="middle" fontSize="12.5" fontWeight="700" fill={WARN}>t°</text>
      <path d={`M415 ${ySup - 15} V54 H${boilerBox.x + boilerBox.w - 40}`}
        stroke={WARN} strokeWidth="1.2" strokeDasharray="4 3" fill="none" />
      <text x={442} y={ySup - 4} fontSize="12.5" fontWeight="600" fill={WARN}>emergency 55 °C</text>
      <text x={442} y={ySup + 13} fontSize="11.5" fill={MUTED}>breaks the heat demand</text>

      {/* ---------- Return ---------- */}
      <path d={`M${manX} ${yRet} H${boilerBox.x + boilerBox.w}`} stroke={BLUE} strokeWidth="4" fill="none" />
      <polygon points={`${boilerBox.x + boilerBox.w + 26},${yRet - 5} ${boilerBox.x + boilerBox.w + 14},${yRet} ${boilerBox.x + boilerBox.w + 26},${yRet + 5}`} fill={BLUE} />
      <text x={boilerBox.x + boilerBox.w + 10} y={yRet + 40} fontSize="14.5" fontWeight="700" fill={BLUE}>
        Return 40 °C
      </text>

      <Valve x={272} y={yRet} label="valve" color={BLUE} />
      <Strainer x={340} y={yRet} label="strainer" />
      <Gauge x={410} y={yRet} label="thermometer" color={BLUE} />

      {/* ---------- Manifold ---------- */}
      <rect x={manX} y={ySup - 26} width={manW} height={yRet - ySup + 52} rx="6"
        fill="#fff7ed" stroke={INK} strokeWidth="1.6" />
      <text x={manX + manW / 2} y={ySup - 36} textAnchor="middle" fontSize="16" fontWeight="700" fill={INK}>
        Manifold, {loopCount} loops
      </text>

      {/* Combs */}
      <rect x={manX + 14} y={ySup - 8} width={manW - 28} height="16" rx="3" fill={RED} opacity="0.85" />
      <text x={manX + manW / 2} y={ySup + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">
        flow meters
      </text>
      <rect x={manX + 14} y={yRet - 8} width={manW - 28} height="16" rx="3" fill={BLUE} opacity="0.85" />
      <text x={manX + manW / 2} y={yRet + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">
        balancing
      </text>

      {/* Loops */}
      {Array.from({ length: loopCount }, (_, i) => {
        const x = manX + 30 + i * ((manW - 60) / Math.max(1, loopCount - 1));
        return (
          <g key={i}>
            <path d={`M${x} ${ySup + 8} V${yRet - 8}`} stroke="#a16207" strokeWidth="2" fill="none" />
            <text x={x} y={(ySup + yRet) / 2 - 4} textAnchor="middle" fontSize="11"
              fill={MUTED} transform={`rotate(-90 ${x} ${(ySup + yRet) / 2 - 4})`}>
              {loopNames[i] ?? `loop ${i + 1}`}
            </text>
          </g>
        );
      })}
      <text x={manX + manW / 2} y={yRet + 40} textAnchor="middle" fontSize="11.5" fill={MUTED}>
        flow meters are mandatory: length imbalance above 30 %
      </text>

      {/* ---------- Make-up ---------- */}
      <g>
        <rect x={266} y={398} width={352} height="96" rx="6"
          fill="#fef2f2" stroke={WARN} strokeWidth="1.6" strokeDasharray="6 4" />
        <text x={284} y={424} fontSize="14" fontWeight="700" fill={WARN}>
          Make-up — BROKEN-LINE, manual
        </text>
        <text x={284} y={446} fontSize="12" fill={INK}>
          test pump + tank of ready-mixed fluid
        </text>
        <text x={284} y={464} fontSize="12" fill={INK}>
          plug and seal the built-in DHW fill valve
        </text>
        <text x={284} y={482} fontSize="11" fill={MUTED}>
          coolant is toxic, water dilutes the mixture
        </text>
        <path d={`M420 398 V${yRet + 10}`} stroke={WARN} strokeWidth="1.4" strokeDasharray="4 3" fill="none" />
      </g>

      {/* ---------- Outdoor sensor ---------- */}
      <g>
        <rect x={654} y={410} width={330} height="60" rx="6" fill="#eff6ff" stroke={BLUE} strokeWidth="1.4" />
        <text x={672} y={436} fontSize="14" fontWeight="700" fill={BLUE}>Outdoor temperature sensor</text>
        <text x={672} y={457} fontSize="12" fill={INK}>without it the Kt ≈ 7 curve does not work at all</text>
        <path d={`M654 440 H${boilerBox.x + boilerBox.w + 20} V${yRet + 70} H${boilerBox.x + boilerBox.w - 40}`}
          stroke={BLUE} strokeWidth="1.2" strokeDasharray="3 3" fill="none" opacity="0.6" />
      </g>

      {/* ---------- Velocity callout ---------- */}
      {conn && (
        <text x={W - 10} y={26} textAnchor="end" fontSize="12.5" fill={MUTED}>
          connection {conn.thread} · {conn.flowLh.toFixed(0)} l/h · {conn.velocity.toFixed(2)} m/s
          {conn.quiet ? ' — quiet' : ' — NOISY'}
        </text>
      )}
      <text x={10} y={24} fontSize="14" fontWeight="700" fill={INK}>
        Direct low-temperature connection
      </text>
      <text x={10} y={43} fontSize="12" fill={MUTED}>
        without a mixing unit or hydraulic separator
      </text>
    </svg>
  );
}

// src/Admin/ResultCharts.jsx
// Diagramme en anneau (dernier résultat) + diagramme circulaire (répartition du tableau).
// 100 % SVG pur, aucune librairie externe.
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabaseClient';

const ALL_METRICS = ['visitors', 'members', 'music'];

// Couleurs fixes par catégorie (identiques à ProgressChart)
const SERIES_COLORS = {
  'visitors:new':    '#4da3ff',
  'members:new':     '#4ade80',
  'music:listens':   '#ff4d4d',
  'music:downloads': '#a78bfa',
};
const FALLBACK_COLORS = ['#4da3ff', '#4ade80', '#ff4d4d', '#a78bfa', '#fbbf24', '#22d3ee'];

// ---------- Utilitaires SVG ----------
const polar = (cx, cy, r, angleDeg) => {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
};

// Arc en anneau (épaisseur donnée par stroke-width)
const arcPath = (cx, cy, r, startAngle, endAngle) => {
  const start = polar(cx, cy, r, endAngle);
  const end = polar(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
};

// ---------- Diagramme en anneau ----------
const DoughnutChart = ({ data, size = 200, thickness = 30, centerLabel, centerValue }) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2 - 2;

  let angle = 0;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="doughnut-svg"
      role="img"
      aria-label={`Dernier résultat : ${centerLabel} = ${centerValue}`}
    >
      {/* anneau de fond */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1f1f1f" strokeWidth={thickness} />

      {total > 0 &&
        data.map((d) => {
          const slice = (d.value / total) * 360;
          if (slice <= 0) return null;
          const path = arcPath(cx, cy, r, angle, angle + slice);
          const el = (
            <path
              key={d.label}
              d={path}
              fill="none"
              stroke={d.color}
              strokeWidth={thickness}
              strokeLinecap="butt"
              className="doughnut-arc"
            />
          );
          angle += slice;
          return el;
        })}

      <text x={cx} y={cy - 2} textAnchor="middle" className="doughnut-value">
        {centerValue}
      </text>
      <text x={cx} y={cy + 18} textAnchor="middle" className="doughnut-label">
        {centerLabel}
      </text>
    </svg>
  );
};

// ---------- Diagramme circulaire (camembert) ----------
const PieChart = ({ data, size = 220 }) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;

  let angle = 0;

  return (
    <div className="pie-wrapper">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="pie-svg"
        role="img"
        aria-label="Répartition des données du tableau"
      >
        {total > 0 ? (
          data.map((d) => {
            const slice = (d.value / total) * 360;
            const p1 = polar(cx, cy, r, angle);
            const p2 = polar(cx, cy, r, angle + slice);
            const largeArc = slice > 180 ? 1 : 0;
            const path = `M ${cx} ${cy} L ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} 1 ${p2.x} ${p2.y} Z`;
            const mid = angle + slice / 2;
            const labelR = r * 0.68;
            const lp = polar(cx, cy, labelR, mid);
            const pct = ((d.value / total) * 100).toFixed(0);
            const el = (
              <g key={d.label}>
                <path d={path} fill={d.color} stroke="#000" strokeWidth="1.5" className="pie-slice" />
                {slice > 18 && (
                  <text
                    x={lp.x}
                    y={lp.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="pie-pct"
                  >
                    {pct}%
                  </text>
                )}
              </g>
            );
            angle += slice;
            return el;
          })
        ) : (
          <circle cx={cx} cy={cy} r={r} fill="#1f1f1f" />
        )}
      </svg>

      <ul className="pie-legend">
        {data.map((d) => {
          const pct = total > 0 ? ((d.value / total) * 100).toFixed(0) : 0;
          return (
            <li key={d.label}>
              <span className="legend-dot" style={{ background: d.color }} />
              <span className="pie-legend-label">{d.label}</span>
              <strong className="pie-legend-value">
                {d.value.toLocaleString('fr-FR')} <span className="pie-legend-pct">({pct}%)</span>
              </strong>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

// ---------- Composant principal ----------
const ResultCharts = ({ metric, tableItems, refreshKey }) => {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let off = false;
    setLoading(true);
    (async () => {
      const metricsToFetch = metric === 'all' ? ALL_METRICS : [metric];
      const results = await Promise.all(
        metricsToFetch.map((m) =>
          supabase.rpc('get_admin_timeseries', { p_metric: m, p_period: 'month' })
        )
      );
      if (off) return;

      const series = results.flatMap((r, idx) =>
        (r.data?.series || []).map((s) => ({
          ...s,
          _metric: metricsToFetch[idx],
        }))
      );
      setResult({ series });
      setLoading(false);
    })();
    return () => { off = true; };
  }, [metric, refreshKey]);

  // Dernier résultat = dernière valeur de chaque série
  const doughnutData = useMemo(() => {
    if (!result?.series) return [];
    return result.series.map((s, i) => {
      const vals = (s.data?.values || []).map((v) => Number(v) || 0);
      const last = vals.length ? vals[vals.length - 1] : 0;
      const colorKey = s._metric ? `${s._metric}:${s.key}` : null;
      return {
        label: s.name,
        value: last,
        color: (colorKey && SERIES_COLORS[colorKey]) || FALLBACK_COLORS[i % FALLBACK_COLORS.length],
      };
    });
  }, [result]);

  // Camembert : lignes du tableau (uniquement valeurs numériques positives)
  const pieData = useMemo(() => {
    if (!tableItems?.length) return [];
    return tableItems
      .filter((it) => typeof it.value === 'number' && it.value > 0)
      .map((it, i) => ({
        label: it.category,
        value: it.value,
        color: FALLBACK_COLORS[i % FALLBACK_COLORS.length],
      }));
  }, [tableItems]);

  const doughnutTotal = doughnutData.reduce((s, d) => s + d.value, 0);
  const centerLabel = doughnutData.length === 1 ? 'Dernier total' : 'Total cumulé';

  return (
    <div className="result-charts">
      <h3 className="result-charts-title">
        <i className="fas fa-bullseye"></i> Résultats finaux
      </h3>

      <div className="result-charts-grid">
        {/* Anneau : dernier résultat */}
        <div className="result-chart-cell">
          <h4 className="result-chart-caption">
            <i className="fas fa-circle-notch"></i> Dernier résultat final
          </h4>
          {loading ? (
            <div className="progress-state">Chargement…</div>
          ) : doughnutData.length === 0 ? (
            <div className="progress-state">Aucune donnée.</div>
          ) : (
            <>
              <DoughnutChart
                data={doughnutData}
                centerLabel={centerLabel}
                centerValue={doughnutTotal.toLocaleString('fr-FR')}
              />
              <ul className="doughnut-legend">
                {doughnutData.map((d) => (
                  <li key={d.label}>
                    <span className="legend-dot" style={{ background: d.color }} />
                    <span>{d.label}</span>
                    <strong>{d.value.toLocaleString('fr-FR')}</strong>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Camembert : tableau en image */}
        <div className="result-chart-cell">
          <h4 className="result-chart-caption">
            <i className="fas fa-chart-pie"></i> Répartition (tableau)
          </h4>
          {pieData.length > 0 ? (
            <PieChart data={pieData} />
          ) : (
            <div className="progress-state">Aucune valeur numérique à représenter.</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResultCharts;

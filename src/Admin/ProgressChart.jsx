// src/Admin/ProgressChart.jsx
// Diagrammes de progression (jour / semaine / mois / année).
// Chaque catégorie a une COULEUR FIXE (voir SERIES_COLORS).
// metric="all" fusionne toutes les catégories sur un même graphique.
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { CountUp } from '../utils/CountUp';

const PERIODS = [
  { key: 'day', label: 'Jour', hint: '30 derniers jours' },
  { key: 'week', label: 'Semaine', hint: '12 dernières semaines' },
  { key: 'month', label: 'Mois', hint: '12 derniers mois' },
  { key: 'year', label: 'Année', hint: '5 dernières années' },
];

// ⭐ Couleurs fixes par catégorie : chaque ligne garde SA couleur partout.
const SERIES_COLORS = {
  'visitors:new':    '#4da3ff', // bleu
  'members:new':     '#4ade80', // vert
  'music:listens':   '#ff4d4d', // rouge
  'music:downloads': '#a78bfa', // violet
  'vip:new':         '#fbbf24', // or
};
const FALLBACK_COLORS = ['#4da3ff', '#4ade80', '#ff4d4d', '#a78bfa', '#fbbf24', '#22d3ee'];

const ALL_METRICS = ['visitors', 'members', 'music'];

const W = 640, H = 280, PL = 46, PR = 14, PT = 16, PB = 34;
const IW = W - PL - PR;
const IH = H - PT - PB;

const parse = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
};

const formatLabel = (s, period, long = false) => {
  const d = parse(s);
  if (period === 'year') return String(d.getFullYear());
  if (period === 'month') {
    return d.toLocaleDateString('fr-FR', long ? { month: 'long', year: 'numeric' } : { month: 'short', year: '2-digit' });
  }
  if (period === 'week') {
    return long
      ? `Semaine du ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`
      : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  }
  return long
    ? d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
};

const niceStep = (x) => {
  if (x <= 1) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return n * p;
};

const fmtCompact = (v) => {
  if (Math.abs(v) >= 1000) return (v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k';
  return v.toLocaleString('fr-FR');
};

const ProgressChart = ({ metric, refreshKey }) => {
  const [period, setPeriod] = useState('day');
  const [type, setType] = useState('line');
  const [cumul, setCumul] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loadingKey, setLoadingKey] = useState('');
  const [hover, setHover] = useState(null);

  const requestKey = `${metric}|${period}`;

  // ---- Chargement des données (mono ou multi-métrique) ----
  useEffect(() => {
    let off = false;
    setLoadingKey(requestKey);
    (async () => {
      const metricsToFetch = metric === 'all' ? ALL_METRICS : [metric];
      const results = await Promise.all(
        metricsToFetch.map((m) =>
          supabase.rpc('get_admin_timeseries', { p_metric: m, p_period: period })
        )
      );
      if (off) return;

      const firstError = results.find((r) => r.error)?.error;
      if (firstError) {
        setError(firstError.message || 'Données indisponibles.');
        setResult(null);
        setLoadingKey('');
        return;
      }

      const labels = results[0]?.data?.labels || [];
      const series = results.flatMap((r, idx) =>
        (r.data?.series || []).map((s) => ({ ...s, _metric: metricsToFetch[idx] }))
      );

      setError('');
      setResult({ labels, series });
      setLoadingKey('');
    })();
    return () => { off = true; };
  }, [metric, period, refreshKey, requestKey]);

  useEffect(() => { setHover(null); }, [metric, period, type, cumul]);

  const labels = result?.labels || [];
  const n = labels.length;

  // ---- Séries prêtes à dessiner (couleur fixe par catégorie) ----
  const series = useMemo(() => {
    if (!result?.series) return [];
    return result.series.map((s, i) => {
      const raw = (s.data?.values || []).map((v) => Number(v) || 0);
      let acc = Number(s.data?.before) || 0;
      const shown = cumul ? raw.map((v) => (acc += v)) : raw;

      const colorKey = s._metric ? `${s._metric}:${s.key}` : null;
      const color =
        (colorKey && SERIES_COLORS[colorKey]) ||
        FALLBACK_COLORS[i % FALLBACK_COLORS.length];

      return {
        key: `${s._metric || 'm'}-${s.key}`,
        name: s.name,
        color,
        values: shown,
        total: raw.reduce((a, b) => a + b, 0),
        end: shown.length ? shown[shown.length - 1] : 0,
      };
    });
  }, [result, cumul]);

  // ---- Phrase d'insight ----
  const insight = useMemo(() => {
    if (!series.length || !labels.length) return null;
    const main = series[0];
    const v = main.values;
    if (!v.length) return null;
    const last = v[v.length - 1];
    const prev = v.length > 1 ? v[v.length - 2] : 0;
    const lbl = formatLabel(labels[labels.length - 1], period, true);
    if (!prev) return `${lbl} : ${last.toLocaleString('fr-FR')} ${main.name.toLowerCase()}`;
    const pct = Math.round(((last - prev) / prev) * 100);
    const dir = pct > 0 ? 'hausse' : pct < 0 ? 'baisse' : 'stable';
    const suffix = pct !== 0 ? ` de ${Math.abs(pct)} %` : '';
    return `${lbl} : ${last.toLocaleString('fr-FR')} ${main.name.toLowerCase()} (${dir}${suffix} vs période précédente)`;
  }, [series, labels, period]);

  // ---- Échelles ----
  const maxVal = Math.max(0, ...series.flatMap((s) => s.values));
  const step = niceStep(maxVal / 4);
  const yMax = step * 4;
  const ticks = [0, 1, 2, 3, 4].map((k) => k * step);

  const band = n ? IW / n : IW;
  const cx = (i) => PL + (i + 0.5) * band;
  const cy = (v) => PT + IH - (v / yMax) * IH;
  const labelEvery = Math.max(1, Math.ceil(n / 7));

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !n) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.floor((x - PL) / band);
    setHover(i >= 0 && i < n ? i : null);
  };

  // ---- Export CSV ----
  const exportCSV = () => {
    if (!series.length || !labels.length) return;
    const head = ['Période', ...series.map((s) => s.name)];
    const rows = labels.map((l, i) => [formatLabel(l, period, true), ...series.map((s) => s.values[i] ?? 0)]);
    const csv = [head, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `progression-${metric}-${period}${cumul ? '-cumule' : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Export PNG ----
  const exportPNG = () => {
    if (!series.length || !labels.length) return;
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#999';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ticks.forEach((t) => {
      const y = cy(t);
      ctx.beginPath();
      ctx.moveTo(PL, y);
      ctx.lineTo(W - PR, y);
      ctx.stroke();
      ctx.fillText(fmtCompact(t), PL - 8, y);
    });

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    labels.forEach((l, i) => {
      if (i % labelEvery === 0 || i === n - 1) {
        ctx.fillText(formatLabel(l, period), cx(i), H - 12);
      }
    });

    series.forEach((s, si) => {
      if (type === 'line') {
        const pts = s.values.map((v, i) => [cx(i), cy(v)]);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        pts.slice(1).forEach((p) => ctx.lineTo(p[0], p[1]));
        ctx.lineTo(pts[pts.length - 1][0], PT + IH);
        ctx.lineTo(pts[0][0], PT + IH);
        ctx.closePath();
        ctx.fillStyle = s.color + '33';
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        pts.slice(1).forEach((p) => ctx.lineTo(p[0], p[1]));
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
      } else {
        const bw = Math.max(3, (band * 0.7) / series.length);
        s.values.forEach((v, i) => {
          const x = cx(i) - (bw * series.length) / 2 + si * bw;
          const h = Math.max(v > 0 ? 2 : 0, (v / yMax) * IH);
          ctx.fillStyle = s.color;
          ctx.fillRect(x, PT + IH - h, Math.max(1, bw - 1), h);
        });
      }
    });

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `progression-${metric}-${period}${cumul ? '-cumule' : ''}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const current = PERIODS.find((p) => p.key === period);
  const loading = loadingKey === requestKey && !result;
  const empty = !loading && !error && series.length === 0;
  const chartKey = `${metric}-${period}-${type}-${cumul}`;

  return (
    <div className="progress-panel">
      <div className="progress-head">
        <h3 className="progress-title">
          <i className="fas fa-chart-line"></i>{' '}
          {metric === 'all' ? "Vue d'ensemble" : 'Progression'}
        </h3>
        <div className="progress-head-right">
          <span className="progress-hint">{current.hint}</span>
          {!loading && !error && series.length > 0 && (
            <div className="progress-export">
              <button type="button" className="export-btn" onClick={exportCSV} title="Exporter les données en CSV">
                <i className="fas fa-file-csv"></i> CSV
              </button>
              <button type="button" className="export-btn" onClick={exportPNG} title="Exporter le graphique en PNG">
                <i className="fas fa-image"></i> PNG
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="progress-controls">
        <div className="seg" role="tablist" aria-label="Période">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={period === p.key}
              className={`seg-btn ${period === p.key ? 'on' : ''}`}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="seg" aria-label="Type de diagramme">
          <button type="button" aria-pressed={type === 'line'} className={`seg-btn ${type === 'line' ? 'on' : ''}`} onClick={() => setType('line')}>
            <i className="fas fa-chart-line"></i> Courbe
          </button>
          <button type="button" aria-pressed={type === 'bar'} className={`seg-btn ${type === 'bar' ? 'on' : ''}`} onClick={() => setType('bar')}>
            <i className="fas fa-chart-bar"></i> Barres
          </button>
        </div>
        <div className="seg" aria-label="Mode de calcul">
          <button type="button" aria-pressed={!cumul} className={`seg-btn ${!cumul ? 'on' : ''}`} onClick={() => setCumul(false)}>
            Par {period === 'day' ? 'jour' : period === 'week' ? 'semaine' : period === 'month' ? 'mois' : 'an'}
          </button>
          <button type="button" aria-pressed={cumul} className={`seg-btn ${cumul ? 'on' : ''}`} onClick={() => setCumul(true)}>Cumulé</button>
        </div>
      </div>

      {loading && <div className="progress-state">Chargement du diagramme…</div>}

      {error && (
        <div className="progress-state progress-error">
          <p>Diagramme indisponible ({error}).</p>
          <p>Relancez le SQL <strong>admin_stats.sql</strong> dans Supabase (il contient <code>get_admin_timeseries</code>).</p>
          <button type="button" className="close-details" onClick={() => setPeriod((p) => (p === 'day' ? 'week' : 'day'))}>
            Réessayer
          </button>
        </div>
      )}

      {empty && (
        <div className="progress-state">
          {metric === 'vip' ? 'Aucune donnée VIP en base pour le moment.' : 'Aucune donnée pour cette période.'}
        </div>
      )}

      {!loading && !error && series.length > 0 && (
        <>
          {insight && (
            <div className="progress-insight">
              <i className="fas fa-lightbulb"></i> {insight}
            </div>
          )}

          <div className="progress-summary">
            {series.map((s) => (
              <div key={s.key} className="summary-item">
                <span className="legend-dot" style={{ background: s.color }}></span>
                <span className="summary-name">{s.name}</span>
                <strong className="summary-value"><CountUp value={cumul ? s.end : s.total} /></strong>
                <span className="summary-sub">{cumul ? 'cumulé sur la période affichée' : 'sur la période'}</span>
              </div>
            ))}
          </div>

          <div className="chart-box">
            <svg
              key={chartKey}
              className="progress-svg"
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label={`Progression : ${series.map((s) => s.name).join(', ')}`}
              onPointerMove={onMove}
              onPointerDown={onMove}
              onPointerLeave={() => setHover(null)}
            >
              <defs>
                {series.map((s, i) => (
                  <linearGradient key={s.key} id={`pg-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity="0.35" />
                    <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                  </linearGradient>
                ))}
              </defs>

              {ticks.map((t) => (
                <g key={t}>
                  <line x1={PL} x2={W - PR} y1={cy(t)} y2={cy(t)} className="grid-line" />
                  <text x={PL - 8} y={cy(t) + 4} textAnchor="end" className="axis-text">{fmtCompact(t)}</text>
                </g>
              ))}

              {labels.map((l, i) =>
                i % labelEvery === 0 || i === n - 1 ? (
                  <text key={l} x={cx(i)} y={H - 12} textAnchor="middle" className="axis-text">{formatLabel(l, period)}</text>
                ) : null
              )}

              {hover !== null && (
                <>
                  <rect x={PL + hover * band} y={PT} width={band} height={IH} className="hover-band" />
                  <line x1={cx(hover)} x2={cx(hover)} y1={PT} y2={PT + IH} className="hover-line" />
                </>
              )}

              {type === 'bar' &&
                series.map((s, si) => {
                  const bw = Math.max(3, (band * 0.7) / series.length);
                  return s.values.map((v, i) => {
                    const x = cx(i) - (bw * series.length) / 2 + si * bw;
                    const h = Math.max(v > 0 ? 2 : 0, (v / yMax) * IH);
                    return (
                      <rect
                        key={`${s.key}-${i}`}
                        x={x}
                        y={PT + IH - h}
                        width={Math.max(1, bw - 1)}
                        height={h}
                        rx="2"
                        fill={s.color}
                        className="bar-rect"
                        style={{ opacity: hover === null || hover === i ? 1 : 0.45 }}
                      />
                    );
                  });
                })}

              {type === 'line' &&
                series.map((s, si) => {
                  const pts = s.values.map((v, i) => [cx(i), cy(v)]);
                  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
                  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${PT + IH} L${pts[0][0].toFixed(1)},${PT + IH} Z`;
                  return (
                    <g key={s.key}>
                      <path d={area} fill={`url(#pg-${si})`} className="area-fade" />
                      <path d={line} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" pathLength="1" className="line-draw" />
                      {(n <= 31 || hover !== null) &&
                        pts.map((p, i) =>
                          n <= 12 || hover === i ? (
                            <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 5 : 3} fill={s.color} stroke="#000" strokeWidth="1.5" />
                          ) : null
                        )}
                    </g>
                  );
                })}
            </svg>

            {hover !== null && (
              <div
                className="chart-tooltip"
                style={{
                  left: `${(cx(hover) / W) * 100}%`,
                  transform: `translateX(${hover > n / 2 ? '-100%' : '0'})`,
                }}
              >
                <div className="tip-date">{formatLabel(labels[hover], period, true)}</div>
                {series.map((s) => (
                  <div key={s.key} className="tip-row">
                    <span className="legend-dot" style={{ background: s.color }}></span>
                    {s.name} : <strong>{s.values[hover].toLocaleString('fr-FR')}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ProgressChart;

// src/Admin/AdminHome.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './AdminHome.css';
import './AdminHomeCharts.css';
import bgImage from '../assets/Images/men_your_brave.jpeg';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';
import ProfileSettingsPanel from './ProfileSettingsPanel';

// ---------------------------------------------------------------
// Données : get_admin_stats / get_admin_timeseries (romeo.sql, section 14)
// + commandes réelles (tables orders / order_items) pour les ventes VIP.
// ---------------------------------------------------------------
const COLORS = ['#ff2d2d', '#ffb020', '#19d38a', '#3aa0ff', '#a78bfa'];
const PERIODS = [['day', '30 jours'], ['week', '12 semaines'], ['month', '12 mois'], ['year', '5 ans']];
const METRICS = {
  visitors: { label: 'Visiteurs', icon: 'eye' },
  members: { label: 'Membres', icon: 'users' },
  vip: { label: 'VIP · Ventes', icon: 'crown' },
  music: { label: 'Musique', icon: 'music' },
};
const nf = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR');
const ar = (n) => `${nf(n)} Ar`;
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : a > 0 ? 100 : 0);

// ----- périodes (heure de Madagascar, UTC+3) -----
const startOf = (d, period) => {
  let x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (period === 'week') x = new Date(x - ((x.getUTCDay() + 6) % 7) * 864e5);
  if (period === 'month') x.setUTCDate(1);
  if (period === 'year') x.setUTCMonth(0, 1);
  return x;
};
const bucketOf = (iso, period) => startOf(new Date(new Date(iso).getTime() + 3 * 3600e3), period).toISOString().slice(0, 10);
const bucketLabels = (period) => {
  const n = { day: 30, week: 12, month: 12, year: 5 }[period];
  const base = startOf(new Date(Date.now() + 3 * 3600e3), period);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(base);
    if (period === 'day') x.setUTCDate(x.getUTCDate() - i);
    if (period === 'week') x.setUTCDate(x.getUTCDate() - 7 * i);
    if (period === 'month') x.setUTCMonth(x.getUTCMonth() - i);
    if (period === 'year') x.setUTCFullYear(x.getUTCFullYear() - i);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
};
const fmtLabel = (l, period) => {
  const [y, m, d] = l.split('-');
  return period === 'year' ? y : period === 'month' ? `${m}/${y.slice(2)}` : `${d}/${m}`;
};
const niceMax = (v) => {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
};

// ---------------------------------------------------------------
// Composants animés
// ---------------------------------------------------------------
const CountUp = ({ value, format = nf, duration = 1000 }) => {
  const [n, setN] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const b = Number(value) || 0;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setN(b); from.current = b; return undefined; }
    const a = from.current, t0 = performance.now();
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / duration);
      const v = a + (b - a) * (1 - Math.pow(1 - p, 3));
      from.current = v; setN(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{format(n)}</>;
};

// Courbe / aire (une ou plusieurs séries) — le tracé se dessine à l'affichage
const AreaChart = ({ labels, series, period, unit }) => {
  const W = 640, H = 240, L = 48, R = 14, T = 14, B = 28;
  const iw = W - L - R, ih = H - T - B, n = labels.length;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const x = (i) => L + (n > 1 ? (i * iw) / (n - 1) : iw / 2);
  const y = (v) => T + ih * (1 - v / max);
  const step = Math.ceil(n / 6);
  return (
    <svg className="ah-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Évolution dans le temps">
      <defs>
        {series.map((s, k) => (
          <linearGradient key={k} id={`ah-g${k}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={COLORS[k]} stopOpacity=".45" /><stop offset="1" stopColor={COLORS[k]} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      {[0, 1, 2, 3, 4].map((g) => (
        <g key={g}>
          <line x1={L} x2={W - R} y1={T + (ih * g) / 4} y2={T + (ih * g) / 4} className="ah-grid" />
          <text x={L - 8} y={T + (ih * g) / 4 + 4} className="ah-axis" textAnchor="end">{nf(max - (max * g) / 4)}</text>
        </g>
      ))}
      {labels.map((l, i) => i % step === 0 && (
        <text key={l} x={x(i)} y={H - 8} className="ah-axis" textAnchor="middle">{fmtLabel(l, period)}</text>
      ))}
      {series.map((s, k) => {
        const pts = s.values.map((v, i) => `${x(i)},${y(v)}`);
        return (
          <g key={k}>
            <polygon className="ah-area" fill={`url(#ah-g${k})`} points={`${x(0)},${T + ih} ${pts.join(' ')} ${x(n - 1)},${T + ih}`} />
            <polyline className="ah-line" pathLength="1" stroke={COLORS[k]} points={pts.join(' ')} />
            {n <= 31 && s.values.map((v, i) => (
              <circle key={i} className="ah-dot" cx={x(i)} cy={y(v)} r="3.2" fill={COLORS[k]} style={{ animationDelay: `${600 + i * 18}ms` }}>
                <title>{`${fmtLabel(labels[i], period)} · ${s.name} : ${nf(v)}${unit || ''}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
    </svg>
  );
};

// Anneau (donut)
const Donut = ({ items, centerLabel }) => {
  const total = items.reduce((t, i) => t + i.value, 0);
  let acc = 0;
  return (
    <div className="ah-donut-wrap">
      <svg className="ah-donut" viewBox="0 0 120 120" role="img" aria-label={centerLabel}>
        <circle cx="60" cy="60" r="44" className="ah-donut-track" pathLength="100" />
        {total > 0 && items.map((it, k) => {
          const len = (it.value / total) * 100;
          const el = (
            <circle key={k} cx="60" cy="60" r="44" pathLength="100" className="ah-donut-seg" stroke={COLORS[k]}
              strokeDasharray={`${Math.max(len - 0.6, 0)} ${100 - Math.max(len - 0.6, 0)}`} strokeDashoffset={-acc}
              style={{ animationDelay: `${k * 250}ms` }} />
          );
          acc += len;
          return el;
        })}
        <text x="60" y="58" textAnchor="middle" className="ah-donut-num"><tspan>{nf(total)}</tspan></text>
        <text x="60" y="74" textAnchor="middle" className="ah-donut-lbl">{centerLabel}</text>
      </svg>
      <ul className="ah-legend">
        {items.map((it, k) => (
          <li key={k}><i style={{ background: COLORS[k] }} />{it.label}<b>{total ? Math.round((it.value / total) * 100) : 0}%</b></li>
        ))}
      </ul>
    </div>
  );
};

// Barres verticales
const VBars = ({ items, format = nf }) => {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="ah-vbars">
      {items.map((it, k) => (
        <div key={k} className="ah-vbar">
          <span className="ah-vbar-val">{format(it.value)}</span>
          <div className="ah-vbar-col">
            <div className="ah-vbar-fill" style={{ height: `${(it.value / max) * 100}%`, background: COLORS[k % 5], animationDelay: `${k * 90}ms` }} />
          </div>
          <span className="ah-vbar-lbl">{it.label}</span>
        </div>
      ))}
    </div>
  );
};

// Barres de progression horizontales
const HBars = ({ items }) => (
  <div className="ah-hbars">
    {items.map((it, k) => (
      <div key={k} className="ah-hbar">
        <div className="ah-hbar-top"><span>{it.label}</span><b>{it.text}</b></div>
        <div className="ah-hbar-track">
          <div className="ah-hbar-fill" style={{ width: `${Math.min(100, it.max ? (it.value / it.max) * 100 : 0)}%`, background: COLORS[k % 5], animationDelay: `${k * 120}ms` }} />
        </div>
      </div>
    ))}
  </div>
);

const Panel = ({ title, children, wide }) => (
  <section className={`ah-panel ${wide ? 'wide' : ''}`}><h3>{title}</h3>{children}</section>
);

// ---------------------------------------------------------------
// Construction du contenu de chaque statistique
// ---------------------------------------------------------------
const row = (category, value, cur, prev, unit = '', status) => {
  const p = prev == null ? null : pct(cur, prev);
  return {
    category, value, unit,
    trend: p == null ? '—' : `${p > 0 ? '+' : ''}${p}%`,
    evolution: p == null || p >= 0 ? 'positive' : 'negative',
    status: status || (p == null ? 'Total' : p > 0 ? 'En hausse' : p < 0 ? 'En baisse' : 'Stable'),
  };
};

const summarizeSales = (orders) => {
  const done = orders.filter((o) => o.status === 'livre_paye');
  const wait = orders.filter((o) => o.status !== 'livre_paye');
  const sum = (l) => l.reduce((t, o) => t + Number(o.total || 0), 0);
  const tier = {}, ev = {};
  let units = 0;
  orders.forEach((o) => (o.order_items || []).forEach((i) => {
    const amount = Number(i.unit_price || 0) * Number(i.quantity || 0);
    units += Number(i.quantity || 0);
    tier[i.tier_name] = (tier[i.tier_name] || 0) + amount;
    ev[i.event_title] = (ev[i.event_title] || 0) + amount;
  }));
  return {
    orders: orders.length, doneCount: done.length, waitCount: wait.length,
    revenue: sum(done), pending: sum(wait), units,
    avg: done.length ? sum(done) / done.length : 0,
    tiers: Object.entries(tier).sort((a, b) => b[1] - a[1]).slice(0, 6),
    events: Object.entries(ev).sort((a, b) => b[1] - a[1]).slice(0, 5),
  };
};

const buildView = (key, s, sales) => {
  if (key === 'visitors') {
    const v = s?.visitors || {};
    return {
      title: 'Statistiques des visiteurs',
      rows: [row('Visiteurs uniques (total)', v.total, v.total),
        row("Aujourd'hui (vs hier)", v.today, v.today, v.yesterday),
        row('7 derniers jours (vs 7 précédents)', v.week, v.week, v.prev_week)],
      bars: { title: 'Comparaison', items: [{ label: 'Hier', value: v.yesterday || 0 }, { label: "Aujourd'hui", value: v.today || 0 }, { label: 'Sem. préc.', value: v.prev_week || 0 }, { label: '7 jours', value: v.week || 0 }] },
      hbars: { title: 'Progression', items: [
        { label: "Aujourd'hui / hier", value: v.today || 0, max: Math.max(v.today || 0, v.yesterday || 0), text: `${nf(v.today)} / ${nf(v.yesterday)}` },
        { label: '7 jours / 7 précédents', value: v.week || 0, max: Math.max(v.week || 0, v.prev_week || 0), text: `${nf(v.week)} / ${nf(v.prev_week)}` }] },
    };
  }
  if (key === 'members') {
    const m = s?.members || {};
    const all = (m.valid || 0) + (m.pending || 0) + (m.banned || 0);
    return {
      title: 'Statistiques des membres',
      rows: [row('Membres validés', m.valid, m.valid), row('En attente de validation', m.pending, m.pending, null, '', 'À traiter'),
        row('Membres bannis', m.banned, m.banned), row('Nouveaux (30 jours vs 30 précédents)', m.new_30, m.new_30, m.prev_30)],
      donut: { label: 'membres', items: [{ label: 'Validés', value: m.valid || 0 }, { label: 'En attente', value: m.pending || 0 }, { label: 'Bannis', value: m.banned || 0 }] },
      bars: { title: 'Nouveaux membres', items: [{ label: '30 j préc.', value: m.prev_30 || 0 }, { label: '30 derniers j', value: m.new_30 || 0 }] },
      hbars: { title: 'Répartition', items: [['Validés', m.valid], ['En attente', m.pending], ['Bannis', m.banned]].map(([label, v]) => ({ label, value: v || 0, max: all, text: nf(v) })) },
    };
  }
  if (key === 'music') {
    const u = s?.music || {};
    return {
      title: 'Statistiques des musiques',
      rows: [row('Écoutes totales', u.listens, u.listens), row("Écoutes aujourd'hui (vs hier)", u.listens_today, u.listens_today, u.listens_yesterday),
        row('Téléchargements totaux', u.downloads, u.downloads), row("Téléchargements aujourd'hui (vs hier)", u.downloads_today, u.downloads_today, u.downloads_yesterday),
        row('Morceaux', u.songs, u.songs), row('Albums', u.albums, u.albums)],
      donut: { label: 'actions', items: [{ label: 'Écoutes', value: u.listens || 0 }, { label: 'Téléchargements', value: u.downloads || 0 }] },
      bars: { title: 'Aujourd\u2019hui vs hier', items: [{ label: 'Écoutes hier', value: u.listens_yesterday || 0 }, { label: 'Écoutes auj.', value: u.listens_today || 0 }, { label: 'Téléch. hier', value: u.downloads_yesterday || 0 }, { label: 'Téléch. auj.', value: u.downloads_today || 0 }] },
      hbars: { title: 'Catalogue', items: [{ label: 'Morceaux', value: u.songs || 0, max: Math.max(u.songs || 0, u.albums || 0), text: nf(u.songs) }, { label: 'Albums', value: u.albums || 0, max: Math.max(u.songs || 0, u.albums || 0), text: nf(u.albums) }] },
    };
  }
  const v = sales || summarizeSales([]);
  const topEv = v.events[0]?.[1] || 0;
  return {
    title: 'Statistiques des ventes VIP',
    unit: ' Ar',
    rows: [row("Chiffre d'affaires (livré et payé)", v.revenue, v.revenue, null, ' Ar', 'Encaissé'),
      row('Montant en attente', v.pending, v.pending, null, ' Ar', 'À encaisser'),
      row('Commandes', v.orders, v.orders), row('Commandes livrées et payées', v.doneCount, v.doneCount),
      row('Billets / articles vendus', v.units, v.units), row('Panier moyen', v.avg, v.avg, null, ' Ar')],
    donut: { label: 'commandes', items: [{ label: 'Livrées et payées', value: v.doneCount }, { label: 'En attente', value: v.waitCount }] },
    bars: { title: 'Ventes par catégorie (Ar)', items: v.tiers.map(([label, value]) => ({ label, value })), format: (n) => nf(n) },
    hbars: { title: 'Meilleures publications', items: v.events.map(([label, value]) => ({ label, value, max: topEv, text: ar(value) })) },
  };
};

// ---------------------------------------------------------------
// Page
// ---------------------------------------------------------------
const AdminHome = () => {
  const navigate = useNavigate();
  const { adminLogout } = useAuth();
  const [adminStats, setAdminStats] = useState(null);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [showDetails, setShowDetails] = useState(null);
  const [period, setPeriod] = useState('day');
  const [ts, setTs] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [userPseudo, setUserPseudo] = useState(localStorage.getItem('userPseudo') || 'KILO');
  const [userPhoto, setUserPhoto] = useState(localStorage.getItem('userPhoto') || 'https://cdn-icons-png.flaticon.com/512/149/149071.png');
  const [usersOnline, setUsersOnline] = useState(0);

  const loadAll = useCallback(async () => {
    const [st, od] = await Promise.all([
      supabase.rpc('get_admin_stats'),
      supabase.from('orders')
        .select('id,total,status,created_at,order_items(event_id,event_title,tier_name,unit_price,quantity)')
        .order('created_at', { ascending: false }).limit(5000),
    ]);
    if (st.error) setError(`Statistiques indisponibles : ${st.error.message}`);
    else { setAdminStats(st.data); setError(''); }
    if (!od.error) setOrders(od.data || []);
  }, []);

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 30000);
    return () => clearInterval(t);
  }, [loadAll]);

  useEffect(() => {
    const t = setInterval(() => setUsersOnline(Math.floor(Math.random() * 36) + 15), 10000);
    return () => clearInterval(t);
  }, []);

  // Courbe de progression de la statistique ouverte
  useEffect(() => {
    if (!showDetails) return undefined;
    let off = false;
    setTs(null);
    if (showDetails === 'vip') {
      const labels = bucketLabels(period);
      const idx = Object.fromEntries(labels.map((l, i) => [l, i]));
      const rev = labels.map(() => 0), cnt = labels.map(() => 0);
      orders.forEach((o) => {
        const i = idx[bucketOf(o.created_at, period)];
        if (i === undefined) return;
        cnt[i] += 1;
        if (o.status === 'livre_paye') rev[i] += Number(o.total || 0);
      });
      setTs({ labels, series: [{ name: 'Ventes encaissées', values: rev }] });
    } else {
      supabase.rpc('get_admin_timeseries', { p_metric: showDetails, p_period: period }).then(({ data, error: e }) => {
        if (off || e || !data) return;
        setTs({ labels: data.labels || [], series: (data.series || []).map((s) => ({ name: s.name, values: s.data?.values || [] })) });
      });
    }
    return () => { off = true; };
  }, [showDetails, period, orders]);

  const handleLogout = () => { adminLogout(); navigate('/login'); };

  const sales = summarizeSales(orders);
  const a = adminStats || {};
  const stats = {
    visitors: a.visitors?.total || 0,
    members: a.members?.valid || 0,
    vip: sales.revenue,
    music: a.music?.listens || 0,
  };
  const sub = {
    visitors: `+${nf(a.visitors?.today)} aujourd'hui`,
    members: `${nf(a.members?.pending)} en attente`,
    vip: `${nf(sales.orders)} commandes · ${nf(sales.waitCount)} en attente`,
    music: `${nf(a.music?.downloads)} téléchargements`,
  };
  const view = showDetails ? buildView(showDetails, adminStats, sales) : null;

  return (
    <div className="admin-home" style={{ backgroundImage: `url(${bgImage})` }}>
      <header className="admin-header">
        <div className="header-left">
          <div className="menu-trigger" onClick={() => setMenuOpen(!menuOpen)}>
            <i className={`fas fa-${menuOpen ? 'times' : 'bars'}`}></i>
          </div>
          <div className="profile-header" onClick={() => setProfileSettingsOpen(!profileSettingsOpen)}>
            <img src={userPhoto} alt="Admin" />
            <span>{userPseudo}</span>
          </div>
        </div>
        <div className="welcome-msg">
          <span className="typing">Tableau de Bord - Statistiques</span>
        </div>
        {menuOpen && (
          <div className="side-menu">
            <div className="menu-item" onClick={() => { setProfileSettingsOpen(true); setMenuOpen(false); }}>
              <i className="fas fa-user-circle"></i> Profil
            </div>
            <div className="menu-item" onClick={() => { alert('Fonctionnalité Sécurité à venir'); setMenuOpen(false); }}>
              <i className="fas fa-shield-alt"></i> Sécurité
            </div>
            <div className="menu-item" onClick={handleLogout}>
              <i className="fas fa-sign-out-alt"></i> Déconnexion
            </div>
          </div>
        )}
        {profileSettingsOpen && (
          <ProfileSettingsPanel
            onClose={() => setProfileSettingsOpen(false)}
            userPseudo={userPseudo} setUserPseudo={setUserPseudo}
            userPhoto={userPhoto} setUserPhoto={setUserPhoto}
            stats={stats} usersOnline={usersOnline}
            onLogout={() => { handleLogout(); setProfileSettingsOpen(false); }}
          />
        )}
      </header>

      <main className="admin-main">
        <h1 className="dashboard-title">Statistiques du Site</h1>
        {error && <p className="ah-error" role="alert">{error}</p>}

        <div className="stats-grid">
          {Object.keys(METRICS).map((key, i) => (
            <button key={key} type="button" className={`stat-card ah-card ${showDetails === key ? 'is-open' : ''} ${key === 'vip' ? 'ah-card-vip' : ''}`}
              style={{ animationDelay: `${i * 90}ms` }} onClick={() => setShowDetails(showDetails === key ? null : key)}>
              <div className="stat-header">
                <i className={`fas fa-${METRICS[key].icon} stat-icon`}></i>
                <h3>{METRICS[key].label}</h3>
              </div>
              <div className="stat-value positive">
                <CountUp value={stats[key]} format={key === 'vip' ? ar : nf} />
              </div>
              <div className="ah-card-sub">{sub[key]}</div>
              {key === 'vip' && <div className="ah-card-hint">Voir les ventes et diagrammes</div>}
            </button>
          ))}
        </div>

        {view && (
          <div className="details-section active ah-details" key={showDetails}>
            <h2 className="details-title"><i className="fas fa-chart-bar"></i> {view.title}</h2>

            <div className="ah-infographic">
              <Panel title="Progression dans le temps" wide>
                <div className="ah-tabs" role="tablist">
                  {PERIODS.map(([p, l]) => (
                    <button key={p} type="button" role="tab" aria-selected={period === p} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>{l}</button>
                  ))}
                </div>
                {ts && ts.series.length > 0 ? (
                  <>
                    <AreaChart key={`${showDetails}${period}${orders.length}`} labels={ts.labels} series={ts.series} period={period} unit={showDetails === 'vip' ? ' Ar' : ''} />
                    <ul className="ah-legend row">{ts.series.map((s, k) => <li key={k}><i style={{ background: COLORS[k] }} />{s.name}</li>)}</ul>
                  </>
                ) : <p className="ah-empty">{ts ? 'Pas encore de données pour cette période.' : 'Chargement…'}</p>}
              </Panel>
              {view.donut && <Panel title="Répartition"><Donut items={view.donut.items} centerLabel={view.donut.label} /></Panel>}
              {view.bars && <Panel title={view.bars.title}>{view.bars.items.length ? <VBars items={view.bars.items} format={view.bars.format} /> : <p className="ah-empty">Aucune vente pour le moment.</p>}</Panel>}
              {view.hbars && <Panel title={view.hbars.title}>{view.hbars.items.length ? <HBars items={view.hbars.items} /> : <p className="ah-empty">Aucune vente pour le moment.</p>}</Panel>}
            </div>

            <div className="details-table-wrapper">
              <table className="details-table">
                <thead>
                  <tr><th>Catégorie</th><th>Valeur</th><th>Tendance</th><th>Évolution</th><th>Statut</th></tr>
                </thead>
                <tbody>
                  {view.rows.map((r, i) => (
                    <tr key={r.category} className="ah-row" style={{ animationDelay: `${150 + i * 80}ms` }}>
                      <td><span className="stat-label">{r.category}</span></td>
                      <td><b><CountUp value={r.value} />{r.unit}</b></td>
                      <td className={r.evolution === 'positive' ? 'stat-detail' : 'stat-bad'}>{r.trend}</td>
                      <td className={r.evolution === 'positive' ? 'stat-detail' : 'stat-bad'}>
                        <i className={`fas fa-arrow-${r.evolution === 'positive' ? 'up' : 'down'}`}></i> {r.evolution === 'positive' ? 'positive' : 'négative'}
                      </td>
                      <td>{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="close-details" onClick={() => setShowDetails(null)}>Fermer</button>
          </div>
        )}
      </main>

      <footer className="admin-footer">
        <div className="footer-nav">
          <button className="foot-icon" onClick={() => navigate('/admin/users')}>
            <i className="fas fa-user-friends"></i>
            <span className="users-badge">{usersOnline}</span>
          </button>
          <button className="foot-icon" onClick={() => navigate('/admin/home')}><i className="fas fa-home"></i></button>
          <button className="foot-icon" onClick={() => navigate('/admin/musique')}><i className="fas fa-headphones"></i></button>
          <button className="foot-icon" onClick={() => navigate('/admin/vip')}><i className="fas fa-crown"></i></button>
        </div>
      </footer>
    </div>
  );
};

export default AdminHome;

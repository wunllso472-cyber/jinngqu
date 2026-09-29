// 种子素材：用 SVG 程序化绘制原创的山景插画，避免依赖任何外部图片
function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function ridge(w, h, baseY, amp, n, rand, smooth = true) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push([(i / n) * w, baseY - rand() * amp]);
  let d = `M0 ${h} L0 ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i];
    if (smooth) {
      const [px, py] = pts[i - 1];
      const cx = (px + x) / 2;
      d += ` Q${px.toFixed(1)} ${py.toFixed(1)} ${cx.toFixed(1)} ${((py + y) / 2).toFixed(1)}`;
    } else d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return `${d} L${w} ${pts[pts.length - 1][1].toFixed(1)} L${w} ${h} Z`;
}

function cloud(x, y, s, opacity = 0.85) {
  return `<g fill="#fff" fill-opacity="${opacity}">
    <ellipse cx="${x}" cy="${y}" rx="${90 * s}" ry="${26 * s}"/>
    <ellipse cx="${x - 50 * s}" cy="${y - 10 * s}" rx="${50 * s}" ry="${24 * s}"/>
    <ellipse cx="${x + 40 * s}" cy="${y - 18 * s}" rx="${60 * s}" ry="${30 * s}"/></g>`;
}

/** 山顶小殿：几层金色屋檐 */
function temple(x, y, s) {
  const roof = (yy, ww, hh) =>
    `<path d="M${x - ww / 2 - 14 * s} ${yy} Q${x} ${yy - hh * 1.6} ${x + ww / 2 + 14 * s} ${yy} L${x + ww / 2} ${yy - hh * 0.35} L${x - ww / 2} ${yy - hh * 0.35} Z" fill="#e8b84a"/>`;
  return `<g>
    <rect x="${x - 34 * s}" y="${y - 40 * s}" width="${68 * s}" height="${40 * s}" fill="#b5462f"/>
    ${roof(y - 38 * s, 80 * s, 16 * s)}
    <rect x="${x - 22 * s}" y="${y - 72 * s}" width="${44 * s}" height="${26 * s}" fill="#b5462f"/>
    ${roof(y - 70 * s, 54 * s, 14 * s)}
    <circle cx="${x}" cy="${y - 96 * s}" r="${5 * s}" fill="#f6d27a"/>
  </g>`;
}

/** 白模人物：灰色人形，提供姿态参考 */
function mannequin(x, footY, height, pose = 0) {
  const u = height / 8;
  const armL = [
    [x - 1.1 * u, footY - 5.6 * u, x - 2.0 * u, footY - 4.0 * u],
    [x - 1.1 * u, footY - 5.6 * u, x - 2.2 * u, footY - 7.0 * u],
    [x - 1.1 * u, footY - 5.6 * u, x - 0.3 * u, footY - 4.6 * u],
  ][pose % 3];
  const armR = [
    [x + 1.1 * u, footY - 5.6 * u, x + 2.0 * u, footY - 4.0 * u],
    [x + 1.1 * u, footY - 5.6 * u, x + 1.9 * u, footY - 4.2 * u],
    [x + 1.1 * u, footY - 5.6 * u, x + 2.3 * u, footY - 6.8 * u],
  ][pose % 3];
  const line = ([x1, y1, x2, y2], w) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#d9d9de" stroke-width="${w}" stroke-linecap="round"/>`;
  return `<g>
    <ellipse cx="${x}" cy="${footY}" rx="${1.6 * u}" ry="${0.22 * u}" fill="#000" fill-opacity="0.25"/>
    ${line([x - 0.45 * u, footY - 3.9 * u, x - 0.6 * u, footY - 0.1 * u], 0.62 * u)}
    ${line([x + 0.45 * u, footY - 3.9 * u, x + 0.6 * u, footY - 0.1 * u], 0.62 * u)}
    <path d="M${x - 1.15 * u} ${footY - 6 * u} Q${x} ${footY - 6.3 * u} ${x + 1.15 * u} ${footY - 6 * u} L${x + 0.95 * u} ${footY - 3.6 * u} L${x - 0.95 * u} ${footY - 3.6 * u} Z" fill="#e4e4e8"/>
    ${line(armL, 0.42 * u)}
    ${line(armR, 0.42 * u)}
    <rect x="${x - 0.22 * u}" y="${footY - 6.55 * u}" width="${0.44 * u}" height="${0.6 * u}" fill="#d9d9de"/>
    <ellipse cx="${x}" cy="${footY - 7.1 * u}" rx="${0.55 * u}" ry="${0.68 * u}" fill="#ececf0"/>
  </g>`;
}

export const PALETTES = {
  dawn: { sky: ['#1d2b64', '#f8b26a'], sun: '#ffd89b', layers: ['#6d5a8c', '#4b3f6b', '#2c2745', '#171428'] },
  jade: { sky: ['#8ec5d6', '#e6f4ea'], sun: '#fffbe6', layers: ['#7fa99b', '#4f7f6f', '#2f5d50', '#1b3b33'] },
  dusk: { sky: ['#2b1055', '#ff7e5f'], sun: '#ffcf71', layers: ['#7a3e65', '#55305a', '#342244', '#1c1328'] },
  snow: { sky: ['#9fc5e8', '#f3f7fb'], sun: '#ffffff', layers: ['#e8eef5', '#c2d1e0', '#8ea6bf', '#5b7390'] },
  ink: { sky: ['#dfe6e9', '#f7f3ea'], sun: '#f2c572', layers: ['#b8c2c4', '#8a9699', '#586468', '#2e3739'] },
  cave: { sky: ['#0f2027', '#2c5364'], sun: '#7fd1c7', layers: ['#2a6f6b', '#1f5552', '#163d3b', '#0b2322'] },
  valley: { sky: ['#56ab2f', '#d4fc79'], sun: '#fffde4', layers: ['#79b85a', '#4f9a45', '#2f7a3b', '#1c5128'] },
};

export function landscapeSvg({ w = 1080, h = 1440, palette = 'dawn', seed = 1, templeOn = true, clouds = 3, figure = null, sunPos = [0.72, 0.2] }) {
  const p = PALETTES[palette];
  const rand = rng(seed * 7919);
  const layers = p.layers
    .map((color, i) => {
      const base = h * (0.42 + i * 0.13);
      return `<path d="${ridge(w, h, base, h * (0.18 - i * 0.025), 6 + i * 2, rand, i !== 1)}" fill="${color}"/>`;
    })
    .join('');
  const peakX = w * (0.3 + rand() * 0.4);
  const cl = Array.from({ length: clouds }, (_, i) => cloud(w * (0.15 + rand() * 0.7), h * (0.3 + i * 0.09 + rand() * 0.04), 0.8 + rand() * 0.9, 0.55 + rand() * 0.3)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky[0]}"/><stop offset="1" stop-color="${p.sky[1]}"/></linearGradient>
      <radialGradient id="sun"><stop offset="0" stop-color="${p.sun}"/><stop offset="1" stop-color="${p.sun}" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#sky)"/>
    <circle cx="${w * sunPos[0]}" cy="${h * sunPos[1]}" r="${w * 0.22}" fill="url(#sun)"/>
    <circle cx="${w * sunPos[0]}" cy="${h * sunPos[1]}" r="${w * 0.06}" fill="${p.sun}"/>
    <path d="M${peakX - w * 0.25} ${h * 0.62} L${peakX} ${h * 0.36} L${peakX + w * 0.22} ${h * 0.62} Z" fill="${p.layers[0]}" fill-opacity="0.9"/>
    ${templeOn ? temple(peakX, h * 0.36 + 6, w / 1080) : ''}
    ${layers}
    ${cl}
    ${figure ? mannequin(figure.x ?? w / 2, figure.footY ?? h * 0.9, figure.height ?? h * 0.55, figure.pose ?? 0) : ''}
  </svg>`;
}

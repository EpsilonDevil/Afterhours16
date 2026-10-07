// v0.4.2 Daily Spin wheel artwork, shared by the 3D wheel in the park and the spin screen.
export const SEG_LABEL = { vc500: '500', vc2500: '2,500', vc10000: '10K', vc50000: '50K', vc250000: '250K', gear: 'GEAR', anim: 'ANIM' };
export const SEG_SUB = { vc500: 'VC', vc2500: 'VC', vc10000: 'VC', vc50000: 'VC', vc250000: 'JACKPOT', gear: 'EXCLUSIVE', anim: 'EXCLUSIVE' };
export const SEG_COLOR = { vc500: '#2b3a4a', vc2500: '#2f5f63', vc10000: '#3d6b3a', vc50000: '#7a3c8a', vc250000: '#c9952a', gear: '#b8432e', anim: '#2457c5' };

// draws the wheel face (segment 0 starts at the top, clockwise) into a 2D context
export function drawWheel(g, size, segments, accent = '#ffd84a') {
  const r = size / 2, n = segments.length, step = Math.PI * 2 / n;
  g.clearRect(0, 0, size, size);
  g.save(); g.translate(r, r);
  g.fillStyle = '#111317'; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + i * step - step / 2, a1 = a0 + step;
    const k = segments[i];
    g.fillStyle = SEG_COLOR[k] || '#333';
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r * 0.94, a0, a1); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = Math.max(1, size / 200); g.stroke();
    g.save(); g.rotate(-Math.PI / 2 + i * step + Math.PI / 2);
    g.fillStyle = k === 'vc250000' ? '#fff3c4' : '#f4f1ea';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 ${Math.round(size * 0.062)}px system-ui, sans-serif`;
    g.fillText(SEG_LABEL[k] || k, 0, -r * 0.68);
    g.font = `700 ${Math.round(size * 0.03)}px system-ui, sans-serif`;
    g.fillStyle = 'rgba(255,255,255,.75)';
    g.fillText(SEG_SUB[k] || '', 0, -r * 0.53);
    g.restore();
  }
  // studs on the rim + hub
  for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * step - step / 2; g.fillStyle = accent; g.beginPath(); g.arc(Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97, size * 0.012, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = accent; g.beginPath(); g.arc(0, 0, r * 0.13, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#111317'; g.font = `900 ${Math.round(size * 0.04)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SPIN', 0, 0);
  g.restore();
}

// rotation (radians, clockwise) that brings segment i under the top pointer, after `turns` full spins
export function angleFor(i, n, turns = 5) { return turns * Math.PI * 2 - i * (Math.PI * 2 / n); }

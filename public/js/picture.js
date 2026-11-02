// A picture of the week to share. Hours and rules only, never task names.
export const APP_URL = 'mesocycle.minhtriphamnguyen69.workers.dev';

export async function shareWeek(r, { t, hrs, open = false }) {
  const size = 1080;
  const c = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const g = c.getContext('2d');
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const font = (px, weight = 400) => `${weight} ${px}px Inter, system-ui, sans-serif`;
  g.fillStyle = css('--bg');
  g.fillRect(0, 0, size, size);
  g.fillStyle = css('--fg');
  g.font = font(44, 700);
  g.fillText('Mesocycle', 80, 120);
  g.font = font(76, 700);
  g.fillText(t('recapTitle'), 80, 230);
  let y = 330;
  const step = Math.min(104, Math.floor(520 / Math.max(1, Math.min(6, r.roles.length)))); // room for the lines at the bottom
  r.roles.slice(0, 6).forEach((x, i) => {
    const top = Math.max(x.targetMin, x.doneMin, 1);
    g.fillStyle = css('--fg');
    g.font = font(36, 500);
    g.fillText(x.name.slice(0, 26), 80, y);
    g.fillStyle = css('--muted');
    g.font = font(32);
    g.textAlign = 'right';
    g.fillText(`${hrs(x.doneMin)}h / ${hrs(x.targetMin)}h`, size - 80, y);
    g.textAlign = 'left';
    g.fillStyle = css('--chip');
    g.fillRect(80, y + 20, size - 160, 18);
    g.fillStyle = css(`--r${i % 8}`);
    g.fillRect(80, y + 20, (size - 160) * (x.doneMin / top), 18);
    y += step;
  });
  const kept = r.roles.filter((x) => x.floorMin && x.floorKept).length;
  const floors = r.roles.filter((x) => x.floorMin).length;
  g.fillStyle = css('--fg');
  g.font = font(44, 700);
  g.fillText(t('recapSleep'), 80, size - 190);
  g.font = font(34, 500);
  // Mid-week, a minimum not reached yet is not a miss, so only what is kept is counted.
  if (floors && (!open || kept)) g.fillText(open ? t('recapFloorsSoFar')(kept, floors) : t('recapFloors')(kept, floors), 80, size - 136);
  g.fillStyle = css('--accent') || css('--fg');
  g.font = font(30, 600);
  g.fillText(APP_URL, 80, size - 70);
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
  const file = new File([blob], 'my-week-mesocycle.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: `${t('recapText')} https://${APP_URL}` }).catch(() => {}); return; }
  Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: file.name }).click();
}

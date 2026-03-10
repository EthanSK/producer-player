from pathlib import Path
import math
import subprocess
import shutil

ROOT = Path('/Users/ethansk/Projects/producer-player')
OUT = ROOT / 'docs/assets/icon/ordering-refinement-round2-2026-03-10'
OUT.mkdir(parents=True, exist_ok=True)

W = H = 1024

COLORS = {
    'bg0': '#06101C',
    'bg1': '#0F2847',
    'bg2': '#1D5588',
    'cyan': '#7DE4FF',
    'cyan2': '#99EEFF',
    'blue': '#3C95FF',
    'ink': '#071B31',
    'soft': '#D8F6FF',
    'line': '#8BE6FF',
}


def defs(prefix: str) -> str:
    return f'''
    <defs>
      <linearGradient id="{prefix}-bg" x1="90" y1="50" x2="940" y2="980" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="{COLORS['bg0']}"/>
        <stop offset="0.54" stop-color="{COLORS['bg1']}"/>
        <stop offset="1" stop-color="{COLORS['bg2']}"/>
      </linearGradient>
      <radialGradient id="{prefix}-glow" cx="0" cy="0" r="1" gradientTransform="translate(760 220) rotate(135) scale(560)">
        <stop stop-color="{COLORS['cyan']}" stop-opacity="0.34"/>
        <stop offset="1" stop-color="{COLORS['cyan']}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="{prefix}-ring" x1="250" y1="230" x2="780" y2="780" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="{COLORS['cyan']}"/>
        <stop offset="1" stop-color="{COLORS['blue']}"/>
      </linearGradient>
      <linearGradient id="{prefix}-track" x1="220" y1="260" x2="800" y2="700" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="{COLORS['cyan2']}" stop-opacity="0.92"/>
        <stop offset="1" stop-color="{COLORS['blue']}" stop-opacity="0.88"/>
      </linearGradient>
      <filter id="{prefix}-blur" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="18"/>
      </filter>
      <filter id="{prefix}-softblur" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="9"/>
      </filter>
      <filter id="{prefix}-shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#020913" flood-opacity="0.45"/>
      </filter>
    </defs>
    '''


def squircle_bg(prefix: str) -> str:
    return f'''
    <rect x="32" y="32" width="960" height="960" rx="220" fill="url(#{prefix}-bg)"/>
    <rect x="32" y="32" width="960" height="960" rx="220" fill="url(#{prefix}-glow)"/>
    <rect x="48" y="48" width="928" height="928" rx="204" fill="none" stroke="#8FDFFF" stroke-opacity="0.10" stroke-width="2"/>
    '''


def badge(x, y, n, scale=1.0):
    r = 24 * scale
    fs = 34 * scale
    return f'''
    <circle cx="{x}" cy="{y}" r="{r}" fill="{COLORS['cyan']}" fill-opacity="0.97"/>
    <text x="{x}" y="{y + 0.35 * fs}" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="{fs}" font-weight="800" fill="{COLORS['ink']}">{n}</text>
    '''


def play_triangle(cx, cy, w=118, h=132, fill='url(#RING)'):
    x0 = cx - w*0.36
    y0 = cy - h/2
    y1 = cy + h/2
    x1 = cx + w*0.46
    return f'<path d="M{x0:.1f} {y0:.1f}C{x0:.1f} {y0-12:.1f} {x0+13:.1f} {y0-18:.1f} {x0+30:.1f} {y0-9:.1f}L{x1:.1f} {cy:.1f}C{x1+18:.1f} {cy+10:.1f} {x1+18:.1f} {cy-10:.1f} {x1:.1f} {cy:.1f}L{x0+30:.1f} {y1+9:.1f}C{x0+13:.1f} {y1+18:.1f} {x0:.1f} {y1+12:.1f} {x0:.1f} {y1:.1f}Z" fill="{fill}"/>'


def orbit(cx, cy, prefix, scale=1.0, inner_play=True, accent_nodes=4):
    r0 = 96 * scale
    r1 = 138 * scale
    r2 = 176 * scale
    stroke = 10 * scale
    node_r = 10 * scale
    parts = [
        f'<circle cx="{cx}" cy="{cy}" r="{r2}" stroke="#73DBFF" stroke-opacity="0.14" stroke-width="{24*scale}"/>',
        f'<circle cx="{cx}" cy="{cy}" r="{r1}" stroke="url(#{prefix}-ring)" stroke-opacity="0.42" stroke-width="{stroke}"/>',
        f'<circle cx="{cx}" cy="{cy}" r="{r0}" fill="#0A1C33" stroke="#1D4D7C" stroke-width="{8*scale}"/>',
        f'<circle cx="{cx}" cy="{cy}" r="{r2+20*scale}" stroke="#8AE8FF" stroke-opacity="0.08" stroke-width="{6*scale}" stroke-dasharray="{18*scale} {30*scale}"/>',
    ]
    for i in range(accent_nodes):
        ang = -90 + i * (360 / accent_nodes)
        rad = math.radians(ang)
        x = cx + math.cos(rad) * r2
        y = cy + math.sin(rad) * r2
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{node_r}" fill="{COLORS["cyan"]}"/>')
    if inner_play:
        parts.append(play_triangle(cx + 8*scale, cy, w=118*scale, h=132*scale, fill=f'url(#{prefix}-ring)'))
    return '\n'.join(parts)


def row(x, y, w, prefix, active=False, num='1', taper=1.0, arrow=False):
    fill_opacity = 0.12 + (0.06 if active else 0)
    h = 90
    badge_x = x + 46
    line_x = x + 100
    line_end = x + 100 + (w - 180) * taper
    body = [
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="44" fill="#D4F3FF" fill-opacity="{fill_opacity:.2f}"/>',
        badge(badge_x, y + h/2, num),
        f'<path d="M{line_x} {y + h/2}H{line_end}" stroke="url(#{prefix}-track)" stroke-width="16" stroke-linecap="round" stroke-opacity="{0.95 if active else 0.78}"/>'
    ]
    if arrow:
        ax = line_end - 14
        ay = y + h/2
        body.append(f'<path d="M{ax} {ay-34}L{ax+72} {ay}L{ax} {ay+34}Z" fill="url(#{prefix}-ring)" fill-opacity="0.88"/>')
    return '\n'.join(body)


def option_sequence_orbit(prefix):
    return f'''
    {row(186, 258, 548, prefix, active=False, num='1', taper=1.00)}
    {row(186, 388, 580, prefix, active=True, num='2', taper=1.00, arrow=True)}
    {row(186, 518, 516, prefix, active=False, num='3', taper=0.82)}
    <path d="M726 434H806" stroke="url(#{prefix}-track)" stroke-width="18" stroke-linecap="round" opacity="0.72"/>
    {orbit(760, 434, prefix, scale=0.96, accent_nodes=4)}
    '''


def option_queue_halo(prefix):
    return f'''
    <g filter="url(#{prefix}-shadow)">
      <rect x="190" y="286" width="430" height="104" rx="40" fill="#D4F3FF" fill-opacity="0.10"/>
      <rect x="238" y="408" width="490" height="108" rx="42" fill="#D4F3FF" fill-opacity="0.17"/>
      <rect x="286" y="536" width="550" height="112" rx="46" fill="#D4F3FF" fill-opacity="0.12"/>
    </g>
    {badge(248, 338, '1')}
    {badge(296, 462, '2')}
    {badge(344, 592, '3')}
    <path d="M318 338H562" stroke="url(#{prefix}-track)" stroke-width="16" stroke-linecap="round" opacity="0.78"/>
    <path d="M366 462H678" stroke="url(#{prefix}-track)" stroke-width="18" stroke-linecap="round" opacity="0.95"/>
    <path d="M414 592H722" stroke="url(#{prefix}-track)" stroke-width="16" stroke-linecap="round" opacity="0.72"/>
    <g filter="url(#{prefix}-blur)" opacity="0.55">
      <circle cx="708" cy="462" r="150" fill="url(#{prefix}-ring)"/>
    </g>
    {orbit(708, 462, prefix, scale=0.86, accent_nodes=6)}
    '''


def option_playlist_spine(prefix):
    return f'''
    <path d="M240 304H414L492 414H636L710 520H804" fill="none" stroke="url(#{prefix}-track)" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M240 304V720H560" fill="none" stroke="#86E7FF" stroke-opacity="0.28" stroke-width="8" stroke-linecap="round"/>
    {badge(240, 304, '1')}
    {badge(492, 414, '2')}
    {badge(710, 520, '3')}
    <rect x="222" y="610" width="382" height="96" rx="42" fill="#D4F3FF" fill-opacity="0.11"/>
    <path d="M300 658H528" stroke="url(#{prefix}-track)" stroke-width="16" stroke-linecap="round" opacity="0.78"/>
    {orbit(762, 520, prefix, scale=0.82, accent_nodes=4)}
    '''


def option_track_ladder(prefix):
    return f'''
    <path d="M210 292V624" stroke="#86E7FF" stroke-opacity="0.34" stroke-width="10" stroke-linecap="round"/>
    <circle cx="210" cy="292" r="12" fill="{COLORS['cyan']}"/>
    <circle cx="210" cy="458" r="12" fill="{COLORS['cyan']}"/>
    <circle cx="210" cy="624" r="12" fill="{COLORS['cyan']}"/>
    {row(236, 248, 574, prefix, active=False, num='1', taper=1.00)}
    {row(236, 414, 574, prefix, active=True, num='2', taper=1.00, arrow=True)}
    {row(236, 580, 574, prefix, active=False, num='3', taper=0.78)}
    '''


OPTIONS = [
    ('01-sequence-orbit-pro', 'Sequence Orbit Pro', 'closest to Neural Playhead, ordering made explicit', option_sequence_orbit),
    ('02-queue-halo', 'Queue Halo', 'playlist cards feeding a premium playhead', option_queue_halo),
    ('03-playlist-spine', 'Playlist Spine', 'numbered path + producer-style intelligence cue', option_playlist_spine),
    ('04-track-ladder-pro', 'Track Ladder Pro', 'cleanest list-order metaphor, still music-first', option_track_ladder),
]


def icon_svg(name, title, subtitle, fn):
    prefix = name.replace('-', '_')
    return f'''<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
    {defs(prefix)}
    {squircle_bg(prefix)}
    {fn(prefix)}
    </svg>
    '''

for name, title, subtitle, fn in OPTIONS:
    svg = icon_svg(name, title, subtitle, fn)
    (OUT / f'{name}.svg').write_text(svg)


def card(x, y, name, title, subtitle, fn):
    prefix = f'card_{name.replace("-", "_")}'
    icon_scale = 0.39
    icon_x = x + 42
    icon_y = y + 80
    return f'''
    <rect x="{x}" y="{y}" width="680" height="462" rx="36" fill="#081325" fill-opacity="0.82" stroke="#8FDFFF" stroke-opacity="0.12" stroke-width="2"/>
    <g transform="translate({icon_x} {icon_y}) scale({icon_scale})">
      {defs(prefix)}
      {squircle_bg(prefix)}
      {fn(prefix)}
    </g>
    <text x="{x + 42}" y="{y + 388}" font-family="Helvetica Neue, Arial, sans-serif" font-size="46" font-weight="800" fill="#F4FAFF">{title}</text>
    <text x="{x + 42}" y="{y + 430}" font-family="Helvetica Neue, Arial, sans-serif" font-size="24" font-weight="500" fill="#A9CBE3">{subtitle}</text>
    '''

composite_cards = []
positions = [(60, 170), (860, 170), (60, 690), (860, 690)]
for (name, title, subtitle, fn), (x, y) in zip(OPTIONS, positions):
    composite_cards.append(card(x, y, name, title, subtitle, fn))

composite_svg = f'''<svg width="1600" height="1240" viewBox="0 0 1600 1240" fill="none" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="sheet-bg" x1="0" y1="0" x2="1600" y2="1240" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#031225"/>
    <stop offset="0.52" stop-color="#113356"/>
    <stop offset="1" stop-color="#234D7A"/>
  </linearGradient>
  <radialGradient id="sheet-glow" cx="0" cy="0" r="1" gradientTransform="translate(1140 180) rotate(140) scale(980)">
    <stop stop-color="#7DE4FF" stop-opacity="0.26"/>
    <stop offset="1" stop-color="#7DE4FF" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="1600" height="1240" fill="url(#sheet-bg)"/>
<rect width="1600" height="1240" fill="url(#sheet-glow)"/>
<text x="60" y="90" font-family="Helvetica Neue, Arial, sans-serif" font-size="72" font-weight="800" fill="#F4FAFF">Producer Player icon refinement options</text>
<text x="60" y="132" font-family="Helvetica Neue, Arial, sans-serif" font-size="28" font-weight="500" fill="#B0D2E8">Ordering / sequencing first, still rooted in the original Neural Playhead feel</text>
{''.join(composite_cards)}
</svg>
'''
(OUT / 'ordering-round2-composite-sheet.svg').write_text(composite_svg)

readme = '''# Producer Player icon ordering refinements — round 2

These are **review-only** icon explorations. The shipped app icon has **not** been replaced.

## Intent

Ethan asked for:
- something that more clearly implies **ordering of songs / sequencing / playlist arrangement**
- still closer to the strongest earlier concept, especially the first concept (**Neural Playhead**)
- multiple real options to review before choosing a final app icon

## Options

1. **Sequence Orbit Pro** — safest evolution of the original circular playhead idea, with explicit 1/2/3 ordered tracks.
2. **Queue Halo** — layered playlist cards feeding into a glowing playback core.
3. **Playlist Spine** — a connected numbered path for a smarter / AI-producer feel.
4. **Track Ladder Pro** — the clearest straight-up ordering metaphor, cleaner and more literal.

## Best files to send

- Composite sheet: `docs/assets/icon/ordering-refinement-round2-2026-03-10/ordering-round2-composite-sheet.png`
- `docs/assets/icon/ordering-refinement-round2-2026-03-10/01-sequence-orbit-pro.png`
- `docs/assets/icon/ordering-refinement-round2-2026-03-10/02-queue-halo.png`
- `docs/assets/icon/ordering-refinement-round2-2026-03-10/03-playlist-spine.png`
- `docs/assets/icon/ordering-refinement-round2-2026-03-10/04-track-ladder-pro.png`
'''
(OUT / 'README.md').write_text(readme)

# render svg -> png via qlmanage thumbnailer
for svg_path in list(OUT.glob('*.svg')):
    tmpdir = OUT / '.render'
    tmpdir.mkdir(exist_ok=True)
    size = '1600' if 'composite' in svg_path.name else '1024'
    subprocess.run(['qlmanage', '-t', '-s', size, '-o', str(tmpdir), str(svg_path)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    thumb = tmpdir / f'{svg_path.name}.png'
    target = OUT / f'{svg_path.stem}.png'
    if target.exists():
        target.unlink()
    shutil.move(str(thumb), str(target))

shutil.rmtree(OUT / '.render', ignore_errors=True)
print(f'Generated assets in {OUT}')

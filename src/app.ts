/**
 * A focused, single-war timeline — shared by timeline.ofww1.org and
 * timeline.ofww2.org. Loads the war's pre-baked events (public/events.json),
 * draws them with the timel.in core as swimlanes (by event type or by country),
 * and opens a Wikidata/Wikipedia detail panel on click. Vanilla TS — it uses the
 * framework-agnostic core directly.
 */
import {
  Timeline,
  formatYearRange,
  type TimelineEvent,
  type TimelineGroup,
} from '../lib/core/index';

export interface WarConfig {
  key: string;
  title: string;
  subtitle: string;
  /** Initial visible range. */
  range: [number, number];
  /** Hard pan/zoom bounds — the view can't leave this window. */
  extent: [number, number];
}

type GroupMode = 'type' | 'country';

const PALETTE = [
  'oklch(0.66 0.14 28)',
  'oklch(0.70 0.13 45)',
  'oklch(0.72 0.12 150)',
  'oklch(0.70 0.11 232)',
  'oklch(0.71 0.10 320)',
  'oklch(0.74 0.115 78)',
  'oklch(0.70 0.11 260)',
  'oklch(0.72 0.12 60)',
  'oklch(0.69 0.10 172)',
  'oklch(0.71 0.11 138)',
  'oklch(0.66 0.12 12)',
  'oklch(0.70 0.12 200)',
];
const CAP = 14;
/** Bright gold for the war's igniting / casus-belli events, so they stand out. */
const CAUSE_COLOR = 'oklch(0.85 0.15 90)';

function eventCountry(e: TimelineEvent): string | undefined {
  const d = e.data as { country?: string } | undefined;
  return d?.country || undefined;
}

function isCause(e: TimelineEvent): boolean {
  return (e.data as { cause?: boolean } | undefined)?.cause === true;
}

interface WdInfo {
  label?: string;
  description?: string;
  wikipedia?: string;
  wikidataUrl: string;
  image?: string;
}

async function fetchInfo(qid: string): Promise<WdInfo> {
  const url =
    'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*' +
    `&ids=${qid}&props=labels|descriptions|sitelinks|claims&languages=en&sitefilter=enwiki`;
  const res = await fetch(url);
  const ent = (((await res.json()) as { entities?: Record<string, unknown> }).entities?.[qid] ?? {}) as {
    labels?: { en?: { value?: string } };
    descriptions?: { en?: { value?: string } };
    sitelinks?: { enwiki?: { title?: string } };
    claims?: { P18?: { mainsnak?: { datavalue?: { value?: string } } }[] };
  };
  const title = ent.sitelinks?.enwiki?.title;
  const img = ent.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return {
    label: ent.labels?.en?.value,
    description: ent.descriptions?.en?.value,
    wikipedia: title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` : undefined,
    wikidataUrl: `https://www.wikidata.org/wiki/${qid}`,
    image: img ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(img)}?width=360` : undefined,
  };
}

const qidFromUrl = (u?: string): string | undefined => (u && /(Q\d+)(?:$|[?#/])/.exec(u)?.[1]) || undefined;

export function mountWar(root: HTMLElement, cfg: WarConfig, dataUrl = 'events.json'): void {
  root.classList.add('ww-app');
  root.innerHTML = `
    <header class="ww-top">
      <div class="ww-brand">
        <span class="ww-title">${cfg.title}</span>
        <span class="ww-sub">${cfg.subtitle}</span>
      </div>
      <div class="ww-tools">
        <span class="ww-by">Lanes</span>
        <div class="ww-seg">
          <button data-mode="type" class="on">By type</button>
          <button data-mode="country">By country</button>
        </div>
        <button class="ww-play">▶ Play</button>
        <a class="ww-ohm" href="https://www.openhistorymap.org" target="_blank" rel="noopener">OHM ↗</a>
      </div>
    </header>
    <main class="ww-main">
      <div class="ww-stage"><div class="ww-tl"></div></div>
      <footer class="ww-status">
        <span class="ww-status-text"></span>
        <span class="ww-credit">made with <span class="ww-heart">♥</span> by
          <a href="https://www.openhistorymap.org" target="_blank" rel="noopener">OpenHistoryMap</a></span>
      </footer>
    </main>
    <aside class="ww-detail" hidden></aside>`;

  const stage = root.querySelector('.ww-stage') as HTMLElement;
  const tlHost = root.querySelector('.ww-tl') as HTMLElement;
  const statusEl = root.querySelector('.ww-status-text') as HTMLElement;
  const detail = root.querySelector('.ww-detail') as HTMLElement;
  const playBtn = root.querySelector('.ww-play') as HTMLButtonElement;
  const segBtns = Array.from(root.querySelectorAll('.ww-seg button')) as HTMLButtonElement[];

  let events: TimelineEvent[] = [];
  let mode: GroupMode = 'type';

  const tl = new Timeline(tlHost, {
    eras: [],
    view: { start: cfg.range[0], end: cfg.range[1] },
    year: (cfg.range[0] + cfg.range[1]) / 2,
    extent: cfg.extent,
    maxHeight: stage.clientHeight || 420,
    groupGutter: 150,
  });

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => tl.setMaxHeight(stage.clientHeight || 420)).observe(stage);
  }

  function recompose(fit: boolean): void {
    const facet = (e: TimelineEvent) => (mode === 'type' ? e.description : eventCountry(e)) || 'Other';
    const counts = new Map<string, number>();
    for (const e of events) counts.set(facet(e), (counts.get(facet(e)) ?? 0) + 1);
    const keep = new Set(
      [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k]) => k)
        .filter((k) => k !== 'Other')
        .slice(0, CAP),
    );
    const labelOf = (e: TimelineEvent) => (keep.has(facet(e)) ? facet(e) : 'Other');
    const order = [...keep];
    if (events.some((e) => !keep.has(facet(e)))) order.push('Other');
    const colors = new Map(order.map((k, i) => [k, PALETTE[i % PALETTE.length]]));

    const groups: TimelineGroup[] = order.map((k, i) => ({ id: k, label: k, color: colors.get(k), order: i }));
    const tagged = events.map((e) =>
      isCause(e)
        ? { ...e, group: labelOf(e), color: CAUSE_COLOR, emphasis: true }
        : { ...e, group: labelOf(e), color: colors.get(labelOf(e)) },
    );
    tl.setGroups(groups);
    tl.setEvents(tagged);
    if (fit) tl.setView(cfg.range[0], cfg.range[1]);
    const causes = events.filter(isCause).length;
    statusEl.textContent =
      `${events.length} events · ${groups.length} lanes` + (causes ? ` · ${causes} key events` : '');
  }

  segBtns.forEach((b) =>
    b.addEventListener('click', () => {
      mode = b.dataset['mode'] as GroupMode;
      segBtns.forEach((x) => x.classList.toggle('on', x === b));
      recompose(false);
    }),
  );

  let playing = false;
  playBtn.addEventListener('click', () => {
    playing = !playing;
    if (playing) {
      tl.play({ yearsPerSecond: cfg.key === 'ww1' ? 1.2 : 1.6 });
      playBtn.textContent = '⏸ Pause';
    } else {
      tl.pause();
      playBtn.textContent = '▶ Play';
    }
  });
  tl.on('pause', () => {
    playing = false;
    playBtn.textContent = '▶ Play';
  });

  let infoToken = 0;
  tl.on('eventSelect', (e) => {
    const token = ++infoToken;
    const qid = qidFromUrl(e.url);
    detail.hidden = false;
    // The title is itself a link: straight to Wikidata now, upgraded to the
    // Wikipedia article once we resolve the sitelink below.
    detail.innerHTML = `
      <button class="ww-close" aria-label="Close">✕</button>
      <span class="ww-d-year">${formatYearRange(e.year, e.endYear)}</span>
      <h2 class="ww-d-title">${
        e.url
          ? `<a class="ww-d-titlelink" href="${e.url}" target="_blank" rel="noopener">${escapeHtml(e.title)} ↗</a>`
          : escapeHtml(e.title)
      }</h2>
      ${e.description ? `<span class="ww-d-kind">${escapeHtml(e.description)}</span>` : ''}
      <div class="ww-d-body"><span class="ww-spin"></span> looking up Wikipedia…</div>`;
    (detail.querySelector('.ww-close') as HTMLElement).addEventListener('click', () => (detail.hidden = true));
    const titleLink = detail.querySelector('.ww-d-titlelink') as HTMLAnchorElement | null;
    if (!qid) {
      (detail.querySelector('.ww-d-body') as HTMLElement).innerHTML = e.url
        ? `<a class="primary" href="${e.url}" target="_blank" rel="noopener">Open source ↗</a>`
        : '<span class="ww-muted">No linked Wikidata record.</span>';
      return;
    }
    fetchInfo(qid)
      .then((info) => {
        if (token !== infoToken) return;
        if (titleLink && info.wikipedia) titleLink.href = info.wikipedia; // prefer Wikipedia
        const body = detail.querySelector('.ww-d-body') as HTMLElement;
        body.innerHTML = `
          ${info.image ? `<img class="ww-d-img" src="${info.image}" alt="" loading="lazy" />` : ''}
          ${info.description ? `<p class="ww-d-desc">${escapeHtml(info.description)}</p>` : ''}
          <div class="ww-d-links">
            ${info.wikipedia ? `<a class="primary" href="${info.wikipedia}" target="_blank" rel="noopener">Read on Wikipedia ↗</a>` : ''}
            <a href="${info.wikidataUrl}" target="_blank" rel="noopener">Wikidata ↗</a>
          </div>`;
      })
      .catch(() => {
        if (token === infoToken) (detail.querySelector('.ww-d-body') as HTMLElement).textContent = 'Lookup failed.';
      });
  });

  statusEl.textContent = 'Loading events…';
  fetch(new URL(dataUrl, document.baseURI).href)
    .then((r) => r.json())
    .then((evs: TimelineEvent[]) => {
      events = evs;
      recompose(true);
    })
    .catch((err) => (statusEl.textContent = `Failed to load events: ${(err as Error).message}`));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

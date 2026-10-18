'use client';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Mark, MarkValues, TextItem } from '../lib/marks.ts';

type Item = TextItem & { fontName: string };
type Styles = Record<string, { fontFamily: string; ascent: number; descent: number }>;
type Loaded = {
  doc: PDFDocumentProxy;
  pages: { items: Item[]; styles: Styles; digital: boolean }[];
  find: (pages: Item[][], values: MarkValues) => Mark[];
  transform: (a: number[], b: number[]) => number[];
};

// The document, drawn with pdf.js page by page at the panel's width, with boxes over the values the AI read where they
// sit in a digital PDF's text. Headless browsers and phones show it the same way, which a browser's own PDF viewer does
// not. It is fetched once per mount and zoom only redraws it: the document route answers no-store, so each fetch would
// cross Vercel and Funnel to the PC again. Each page sits in its own frame at its drawn width, so a zoomed page scrolls
// both ways inside the panel and is never cut on the left.
export function DocumentViewer({ src, filename, values }: { src: string; filename: string; values: MarkValues }) {
  const host = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [loaded, setLoaded] = useState<Loaded>();
  // The zoom last drawn in full; the pages are busy until it equals the zoom asked for.
  const [state, setState] = useState<{ drawn?: number; error?: string }>({});
  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    (async () => {
      try {
        // The worker module runs on this thread, so no worker file has to be served. The matcher comes with pdf.js, so
        // pages without a document never load it.
        // @ts-expect-error -- the worker module ships no types; importing it only registers it.
        await import('pdfjs-dist/build/pdf.worker.min.mjs');
        const [pdfjs, marks] = await Promise.all([import('pdfjs-dist'), import('../lib/marks.ts')]);
        // Left while pdf.js loaded: cleanup had no task to destroy yet, so fetch nothing for a page that is gone.
        if (cancelled) return;
        task = pdfjs.getDocument({ url: src });
        const doc = await task.promise;
        const pages: Loaded['pages'] = [];
        for (let number = 1; number <= doc.numPages; number++) {
          const content = await (await doc.getPage(number)).getTextContent();
          const items = content.items.filter((item) => 'str' in item) as Item[];
          pages.push({ items, styles: content.styles as Styles, digital: marks.isDigital(items) });
        }
        if (!cancelled) setLoaded({ doc, pages, find: marks.findMarks, transform: pdfjs.Util.transform });
      } catch (err) {
        const missing = (err as { status?: number }).status === 404;
        if (!cancelled) setState({ error: missing ? 'No document is stored for this invoice.' : 'The document could not be shown.' });
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [src]);
  // The marks follow the findings: a decision that dismisses one drops its line's tint without fetching the PDF again.
  const key = JSON.stringify(values);
  const marks = useMemo(
    () => (loaded ? loaded.find(loaded.pages.map((page) => page.items), JSON.parse(key) as MarkValues) : []),
    [loaded, key],
  );
  useEffect(() => {
    const pages = host.current;
    if (!loaded || !pages) return;
    let cancelled = false;
    (async () => {
      try {
        pages.replaceChildren();
        const width = Math.max(pages.clientWidth, 240);
        const measure = document.createElement('canvas').getContext('2d')!;
        for (let number = 1; number <= loaded.doc.numPages && !cancelled; number++) {
          const page = await loaded.doc.getPage(number);
          if (cancelled) return;
          const scale = (width / page.getViewport({ scale: 1 }).width) * zoom;
          const viewport = page.getViewport({ scale });
          const output = page.getViewport({ scale: scale * window.devicePixelRatio });
          const frame = document.createElement('div');
          frame.className = 'doc-page';
          const canvas = document.createElement('canvas');
          canvas.width = output.width;
          canvas.height = output.height;
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', `Page ${number} of ${loaded.doc.numPages}`);
          // The marks repeat what the details panel and the charges table say, so screen readers skip them.
          const layer = document.createElement('div');
          layer.className = 'marks';
          layer.setAttribute('aria-hidden', 'true');
          for (const mark of marks.filter((each) => each.page === number - 1)) layer.append(box(mark, loaded.pages[number - 1]!, viewport, loaded.transform, measure));
          frame.append(canvas, layer);
          pages.append(frame);
          await page.render({ canvas, viewport: output }).promise;
        }
        if (!cancelled) setState({ drawn: zoom });
      } catch {
        if (cancelled) return;
        pages.replaceChildren();
        setState({ error: 'The document could not be shown.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, marks, zoom]);
  const count = loaded?.doc.numPages;
  const digital = loaded?.pages.filter((page) => page.digital).length ?? 0;
  const kind = !loaded ? '' : digital === count ? ' · digital' : digital === 0 ? ' · scanned' : ' · digital and scanned';
  return (
    <section className="doc" aria-label="Invoice document">
      <div className="doc-bar">
        <span className="doc-name">
          {state.error ? 'Document' : count ? `${filename}${kind} · ${count} page${count === 1 ? '' : 's'}` : 'Loading document'}
        </span>
        <span className="row">
          <button type="button" className="button small" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
            −
          </button>
          <span className="num" style={{ minWidth: 40 }} aria-live="polite">
            <span className="visually-hidden">Zoom </span>
            {Math.round(zoom * 100)}%
          </span>
          <button type="button" className="button small" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
            +
          </button>
          {!state.error && (
            <a className="button small" href={src} target="_blank" rel="noreferrer">
              Open PDF
            </a>
          )}
        </span>
      </div>
      <div className="doc-pages" role="region" aria-label="Document pages" aria-busy={!state.error && state.drawn !== zoom} tabIndex={0}>
        {state.error && <p className="empty">{state.error}</p>}
        {/* The draw effect owns this element's children; React renders nothing inside it, so a redraw never removes a
            node React still holds. */}
        <div ref={host} />
      </div>
      {loaded && !state.error && (
        <p className="doc-legend faint">
          {digital > 0 ? (
            <>
              <span className="swatch mark-swatch" aria-hidden="true" /> Found by matching the AI&apos;s values in the PDF text
              <span className="swatch line-swatch" aria-hidden="true" /> Line with a finding
            </>
          ) : (
            'Marks need a digital PDF; this one is a scan.'
          )}
        </p>
      )}
    </section>
  );
}

// A mark's box in the page's CSS pixels: from its first character to its last, a little wider than the glyphs. Where a
// mark starts or ends inside a text item, the offset is the share of the item's width that canvas measureText gives the
// characters before it.
function box(mark: Mark, page: Loaded['pages'][number], viewport: PageViewport, transform: Loaded['transform'], measure: CanvasRenderingContext2D) {
  const edge = (item: Item, offset: number) => {
    const matrix = transform(viewport.transform, item.transform);
    const size = Math.hypot(matrix[2]!, matrix[3]!);
    measure.font = `${size}px ${page.styles[item.fontName]?.fontFamily ?? 'sans-serif'}`;
    const whole = measure.measureText(item.str).width;
    const share = whole > 0 ? measure.measureText(item.str.slice(0, offset)).width / whole : 0;
    const style = page.styles[item.fontName];
    const [x, baseline] = [matrix[4]!, matrix[5]!];
    return { x: x + item.width * viewport.scale * share, top: baseline - (style?.ascent || 0.8) * size, bottom: baseline - (style?.descent || -0.2) * size };
  };
  const start = edge(page.items[mark.from.item]!, mark.from.offset);
  const end = edge(page.items[mark.to.item]!, mark.to.offset);
  const div = document.createElement('div');
  div.className = mark.kind === 'line' ? 'mark line' : 'mark';
  const top = Math.min(start.top, end.top) - 2;
  Object.assign(div.style, {
    left: `${start.x - 3}px`,
    top: `${top}px`,
    width: `${end.x - start.x + 6}px`,
    height: `${Math.max(start.bottom, end.bottom) + 2 - top}px`,
  });
  return div;
}

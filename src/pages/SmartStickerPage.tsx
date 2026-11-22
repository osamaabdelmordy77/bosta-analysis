import { useCallback, useEffect, useState } from 'react';
import { Barcode, RefreshCw } from 'lucide-react';
import { SmartStickerSummary, getSmartStickerSummary } from '../services/api';

export function SmartStickerPage({ organizationSlug }: { organizationSlug: string }) {
  const [summary, setSummary] = useState<SmartStickerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  const reload = useCallback(() => setRefresh((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getSmartStickerSummary(organizationSlug)
      .then((result) => { if (active) setSummary(result); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load Smart Sticker shipments.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organizationSlug, refresh]);

  const count = summary?.with_smart_sticker ?? 0;
  const total = summary?.total_shipments ?? 0;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm" aria-label="Smart Sticker shipments">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-sky-50 p-3 text-sky-700"><Barcode size={24} aria-hidden="true" /></span>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Shipments with Smart Sticker No.</h2>
            <p className="mt-1 text-sm text-slate-600">Unique shipments with a value in the Barcode Reference column of active, published imports.</p>
          </div>
        </div>
        <button type="button" className="btn sm" onClick={reload} disabled={loading}>
          <RefreshCw size={15} aria-hidden="true" /> Refresh
        </button>
      </div>
      {error ? <p className="mt-6 text-sm text-rose-700" role="alert">{error}</p> : !loading && summary && !summary.source_has_barcode_reference ? (
        <p className="mt-6 text-sm text-amber-800" role="status">The published reports do not include the Barcode Reference column. Upload a full Bosta export to calculate this count.</p>
      ) : (
        <div className="mt-6" role="status" aria-live="polite">
          <strong className="block text-4xl font-bold text-slate-900">{loading ? '…' : count.toLocaleString()}</strong>
          <span className="mt-2 block text-sm text-slate-600">{loading ? 'Loading shipments…' : `out of ${total.toLocaleString()} unique shipments`}</span>
        </div>
      )}
    </section>
  );
}

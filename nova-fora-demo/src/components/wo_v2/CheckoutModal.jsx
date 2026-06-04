/**
 * CheckoutModal — vendor/tech records "I have the vehicle" at the DSP lot.
 *
 * Opens from the SW dashboard (SwWoActions) when a WO is `accepted` AND
 * primary RO has `scheduled_start_at` (DSP confirmed pickup) AND
 * `picked_up_at` is still NULL. The user (SW or tech) snaps 1-N photos
 * of the van at handoff + optional notes, hits Confirm → backend writes
 * `picked_up_at` + `picked_up_by_id` to every accepted sibling WO on
 * the vehicle, and the WorkOrderPhoto rows land on the target WO.
 *
 * The DSP-side CheckoutVehiclesModal then renders those photos so the
 * fleet owner can see who took their van + what condition it was in.
 *
 * Photo flow (manual to avoid the PhotoUploader commit-per-file path):
 *   1. browser-image-compression on the raw File
 *   2. uploads.presigned({ kind:'work_order', parentId: wo.id }) per file
 *   3. uploads.putToPresigned(uploadUrl, compressed)
 *   4. accumulate storageKey + contentType + sizeBytes
 *   5. woApi.checkout(wo.id, { photos:[...], notes })
 *
 * Errors per-photo show inline; one bad upload doesn't kill the others.
 */
import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  X, Camera, Truck, Loader2, AlertTriangle, Check, Plus,
} from 'lucide-react';
import {
  workOrders as woApi,
  uploads as uploadsApi,
  APIError,
} from '../../api/client';
import { primaryRoLabel } from '../../lib/wo';

const MAX_PHOTOS = 8;

export default function CheckoutModal({ wo, mode = 'checkout', onClose, onSuccess }) {
  // mode = 'checkout' → tech picked up van at DSP lot
  // mode = 'checkin'  → tech returned van to DSP lot (post-2026-06-03)
  // Both legs share the photo-capture UX; only the copy + the backend
  // call swap so the tech sees a consistent "snap → confirm" flow.
  const isCheckin = mode === 'checkin';

  // Each photo: { tempId, file?, previewUrl, storageKey?, contentType?,
  // sizeBytes?, status: 'pending'|'uploading'|'done'|'error', error? }
  const [photos, setPhotos] = useState([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const inputRef = useRef(null);

  const fleetLabel = wo?.vehicleFleetId || wo?.vehicleIdStr || wo?.vehicleId || '—';
  const allDone = photos.length > 0 && photos.every((p) => p.status === 'done');
  const canSubmit = allDone && !busy;

  // Copy that differs between legs — kept inline so the file stays
  // self-contained.
  const COPY = isCheckin ? {
    title: `Check in Van ${fleetLabel}`,
    subtitle: 'Record that you have returned the vehicle to the DSP lot',
    accent: 'accent-purple',
    iconBg: 'bg-accent-purple/15 border-accent-purple/40',
    iconColor: 'text-accent-purple',
    photosLabel: 'Return photos',
    photosHint: 'At least one photo is required so the DSP sees the vehicle\'s condition at drop-off.',
    notesPlaceholder: 'Any new scratches, completed work notes, parking spot, etc.',
    submitLabel: 'Confirm Return',
    submitBg: 'bg-accent-purple hover:bg-accent-purple/90',
    failedMsg: 'Check-in failed',
  } : {
    title: `Check out Van ${fleetLabel}`,
    subtitle: 'Record that you\'ve physically picked up the vehicle',
    accent: 'accent-green',
    iconBg: 'bg-accent-green/15 border-accent-green/40',
    iconColor: 'text-accent-green',
    photosLabel: 'Pickup photos',
    photosHint: 'At least one photo is required so the DSP sees the vehicle\'s condition at handoff.',
    notesPlaceholder: 'Any visible damage, missing items, parking notes, etc.',
    submitLabel: 'Confirm Pickup',
    submitBg: 'bg-accent-green hover:bg-accent-green/90',
    failedMsg: 'Checkout failed',
  };

  // ── Add one photo: compress → presign → PUT → mark done ─────────
  const uploadOne = async (file) => {
    const tempId = `tmp-${crypto.randomUUID()}`;
    const previewUrl = URL.createObjectURL(file);
    setPhotos((cur) => [
      ...cur,
      { tempId, previewUrl, status: 'uploading' },
    ]);
    try {
      // Compress (browser-image-compression is async; pulled lazily so
      // the modal opens fast even on slow connections).
      const imageCompression = (await import('browser-image-compression')).default;
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.5,
        maxWidthOrHeight: 1600,
        useWebWorker: true,
        initialQuality: 0.8,
        fileType: 'image/jpeg',
      });
      const contentType = compressed.type || 'image/jpeg';
      const sizeBytes = compressed.size;
      const { uploadUrl, storageKey } = await uploadsApi.presigned({
        kind: 'work_order',
        parentId: wo.id,
        filename: file.name || 'pickup.jpg',
        contentType,
        sizeBytes,
      });
      await uploadsApi.putToPresigned(uploadUrl, compressed, contentType);
      setPhotos((cur) => cur.map((p) =>
        p.tempId === tempId
          ? { ...p, status: 'done', storageKey, contentType, sizeBytes }
          : p,
      ));
    } catch (err) {
      const msg = err instanceof APIError ? (err.detail || err.message) : (err?.message || 'Upload failed');
      setPhotos((cur) => cur.map((p) =>
        p.tempId === tempId ? { ...p, status: 'error', error: msg } : p,
      ));
    }
  };

  const onPick = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const slots = MAX_PHOTOS - photos.length;
    for (const file of files.slice(0, slots)) {
      uploadOne(file);
    }
  };

  const removePhoto = (tempId) => {
    setPhotos((cur) => cur.filter((p) => p.tempId !== tempId));
  };

  // ── Submit — calls /checkout or /checkin based on mode ─────
  const submit = async () => {
    setBusy(true);
    setSubmitError(null);
    try {
      const body = {
        photos: photos
          .filter((p) => p.status === 'done' && p.storageKey)
          .map((p) => ({
            storageKey: p.storageKey,
            contentType: p.contentType,
            sizeBytes: p.sizeBytes,
          })),
        notes: notes.trim() || undefined,
      };
      const updated = isCheckin
        ? await woApi.checkin(wo.id, body)
        : await woApi.checkout(wo.id, body);
      onSuccess?.(updated);
      onClose();
    } catch (err) {
      const msg = err instanceof APIError ? (err.detail || err.message) : (err?.message || COPY.failedMsg);
      setSubmitError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-12 px-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-navy-900 border border-navy-700 rounded-xl w-full max-w-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-navy-700">
          <div className="flex items-center gap-2">
            <div className={`w-9 h-9 rounded-lg border flex items-center justify-center ${COPY.iconBg}`}>
              <Truck size={16} className={COPY.iconColor} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">{COPY.title}</h3>
              <p className="text-[11px] text-text-muted">
                {primaryRoLabel(wo)} · {COPY.subtitle}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-strong p-2 -mr-2">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Photos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-text-strong flex items-center gap-1.5">
                <Camera size={12} className="text-accent-blue" />
                {COPY.photosLabel}
              </label>
              <span className="text-[10px] text-text-muted">{photos.length} / {MAX_PHOTOS}</span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {photos.map((p) => (
                <div key={p.tempId} className="relative aspect-square rounded-md overflow-hidden border border-navy-700 bg-navy-800">
                  {p.previewUrl && <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />}
                  {p.status === 'uploading' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Loader2 size={18} className="text-white animate-spin" />
                    </div>
                  )}
                  {p.status === 'done' && (
                    <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-accent-green/90 flex items-center justify-center">
                      <Check size={12} className="text-white" />
                    </div>
                  )}
                  {p.status === 'error' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-accent-red/20 p-1 text-center">
                      <AlertTriangle size={14} className="text-accent-red" />
                      <span className="text-[9px] text-accent-red mt-0.5 line-clamp-2">{p.error}</span>
                    </div>
                  )}
                  <button
                    onClick={() => removePhoto(p.tempId)}
                    className="absolute top-1 left-1 w-5 h-5 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center"
                    title="Remove"
                  >
                    <X size={10} className="text-white" />
                  </button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <button
                  onClick={() => inputRef.current?.click()}
                  className="aspect-square rounded-md border-2 border-dashed border-navy-700 hover:border-accent-blue/60 flex flex-col items-center justify-center gap-1 cursor-pointer text-text-muted hover:text-accent-blue transition-colors"
                >
                  <Plus size={16} />
                  <span className="text-[10px]">Add photo</span>
                </button>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={onPick}
              className="hidden"
            />
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="checkout-notes" className="text-xs font-semibold text-text-strong block mb-1.5">
              Notes (optional)
            </label>
            <textarea
              id="checkout-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={COPY.notesPlaceholder}
              rows={3}
              maxLength={500}
              className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white placeholder:text-text-muted outline-none focus:border-accent-blue resize-none"
            />
          </div>

          {submitError && (
            <div className="px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-xs text-accent-red flex items-center gap-2">
              <AlertTriangle size={14} />
              {submitError}
            </div>
          )}

          {photos.length === 0 && (
            <p className="text-[11px] text-text-muted text-center">{COPY.photosHint}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-navy-700 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-navy-800 hover:bg-navy-700 text-white border border-navy-700 disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${COPY.submitBg}`}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {COPY.submitLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * Reusable photo uploader.
 *
 * Flow per file:
 *   1. User picks / snaps photo (native camera via capture="environment")
 *   2. Immediate blob-URL preview (0 ms)
 *   3. Compress in a Web Worker (~200-500 ms, doesn't block UI)
 *   4. Request presigned PUT URL from our API
 *   5. PUT the bytes DIRECTLY to MinIO (no proxy through our backend)
 *   6. Commit metadata to /defects/{id}/photos (increments photo_count)
 *
 * Target: <2 s end-to-end on 4G for a typical 4 MB phone photo.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import imageCompression from 'browser-image-compression';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, X, AlertCircle, RotateCcw, Check } from 'lucide-react';
import { uploads, defects, inspections } from '../../api/client';

const COMPRESSION_OPTIONS = {
  maxSizeMB: 0.5,           // 500 KB target
  maxWidthOrHeight: 1600,   // plenty for a defect photo on any screen
  useWebWorker: true,
  initialQuality: 0.8,
  fileType: 'image/jpeg',   // normalize HEIC/PNG → JPEG to keep backend simple
};

const readDimensions = (blob) =>
  new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      resolve({ width: img.width, height: img.height });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: null, height: null });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });

/**
 * Props:
 *  - parentKind: 'defect' | 'inspection' (work_order in Semana 4)
 *  - parentId:   e.g. 'FD-008' or 'INS-00011'
 *  - category:   default 'damage' for defects, override to 'odometer' / 'overview' / 'qc_after' as needed
 *  - initialPhotos: list from GET /<parent>/{id}/photos (may be empty)
 *  - onChanged: optional callback fired after a successful upload/delete
 *  - readOnly: if true, hide Add button + delete button
 *  - maxPhotos: optional cap (e.g. 1 for odometer)
 */
export default function PhotoUploader({
  parentKind = 'defect',
  parentId,
  category = 'damage',
  initialPhotos = [],
  onChanged,
  readOnly = false,
  maxPhotos = null,
}) {
  const { t } = useTranslation('wizard');
  // Each item: { id?, url?, preview?, status, error?, _retryFile?, tempId? }
  // - id/url come from the server after commit
  // - preview is a local blob URL for optimistic display
  // - status: 'compressing' | 'uploading' | 'done' | 'error'
  // - justCompletedAt: timestamp set when an upload transitions to 'done'.
  //   Used to render a 600 ms green pulse + flash on the thumb.
  const [items, setItems] = useState(() =>
    initialPhotos.map((p) => ({ ...p, status: 'done' }))
  );
  const inputRef = useRef(null);

  // Inline success toast — shows "✓ N photo(s) uploaded" for ~2 s after each
  // successful commit. Multiple rapid uploads accumulate the count rather
  // than stacking toasts.
  const [successCount, setSuccessCount] = useState(0);
  const successTimerRef = useRef(null);
  const showSuccess = () => {
    setSuccessCount((c) => c + 1);
    clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => setSuccessCount(0), 2200);
  };
  useEffect(() => () => clearTimeout(successTimerRef.current), []);

  // Keep local state in sync when parent refetches photos.
  //
  // BUG FIX (2026-05-05): the previous version had `[initialPhotos]` as the
  // effect dep. Since callers default the prop to `[]`, every parent render
  // produced a new array reference → the effect refired on every parent
  // state change → setItems([]) wiped just-uploaded photos from local state.
  // Visible symptom: after taking the mandatory defect photo, the photo
  // disappeared from the gallery and (in some flows) the user got bounced
  // back to an earlier wizard step.
  //
  // Fix: use a stable dep computed from the photos' identities so the effect
  // only fires when the actual content of `initialPhotos` changes.
  const initialPhotosKey = useMemo(
    () => initialPhotos.map((p) => p.id ?? '').join('|'),
    [initialPhotos]
  );
  useEffect(() => {
    setItems(initialPhotos.map((p) => ({ ...p, status: 'done' })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPhotosKey]);

  const uploadOne = async (file, retryItemId) => {
    const tempId = retryItemId || `tmp-${crypto.randomUUID()}`;
    const preview = URL.createObjectURL(file);

    // Optimistic: show the preview the instant the user picks the file
    if (retryItemId) {
      setItems((prev) =>
        prev.map((x) => (x.tempId === retryItemId ? { ...x, status: 'compressing', error: null } : x))
      );
    } else {
      setItems((prev) => [
        ...prev,
        { tempId, preview, status: 'compressing', _retryFile: file },
      ]);
    }

    try {
      // 1. Compress (Web Worker → doesn't freeze UI)
      const compressed = await imageCompression(file, COMPRESSION_OPTIONS);

      // 2. Status: uploading
      setItems((prev) =>
        prev.map((x) => (x.tempId === tempId ? { ...x, status: 'uploading' } : x))
      );

      // 3. Get presigned URL
      const { uploadUrl, storageKey } = await uploads.presigned({
        kind: parentKind,
        parentId,
        filename: file.name || 'photo.jpg',
        contentType: compressed.type || 'image/jpeg',
      });

      // 4. PUT directly to MinIO
      await uploads.putToPresigned(uploadUrl, compressed, compressed.type || 'image/jpeg');

      // 5. Get dimensions (parallel to nothing, so not worth optimizing)
      const dims = await readDimensions(compressed);

      // 6. Commit metadata via the right endpoint per parent type
      const commitBody = {
        storageKey,
        contentType: compressed.type || 'image/jpeg',
        sizeBytes: compressed.size,
        category,
        width: dims.width,
        height: dims.height,
      };
      const saved = parentKind === 'inspection'
        ? await inspections.commitInspectionPhoto(parentId, commitBody)
        : await defects.commitPhoto(parentId, commitBody);

      // 7. Replace temp with real
      setItems((prev) =>
        prev.map((x) =>
          x.tempId === tempId
            ? {
                ...saved,
                status: 'done',
                tempId: null,
                preview: null,
                justCompletedAt: Date.now(),
              }
            : x
        )
      );
      // Release blob URL after a short delay so the swap isn't jarring
      setTimeout(() => URL.revokeObjectURL(preview), 1500);
      // Clear the celebration ring after 700ms (animation finishes)
      setTimeout(() => {
        setItems((prev) => prev.map((x) =>
          x.id === saved.id ? { ...x, justCompletedAt: null } : x
        ));
      }, 700);

      // Inline toast feedback
      showSuccess();

      onChanged?.('added', saved);
    } catch (err) {
      setItems((prev) =>
        prev.map((x) =>
          x.tempId === tempId
            ? {
                ...x,
                status: 'error',
                error: err?.detail || err?.message || 'Upload failed',
              }
            : x
        )
      );
    }
  };

  const handlePicked = async (fileList) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    // Upload sequentially to keep presigned requests ordered and avoid
    // overwhelming the phone's CPU on the compression step.
    for (const f of files) {
      await uploadOne(f);
    }
  };

  const handleRetry = (item) => {
    if (!item._retryFile) return;
    uploadOne(item._retryFile, item.tempId);
  };

  const handleDelete = async (item) => {
    // Cancel a pending upload — just drop from UI
    if (item.tempId) {
      setItems((prev) => prev.filter((x) => x.tempId !== item.tempId));
      if (item.preview) URL.revokeObjectURL(item.preview);
      return;
    }
    // Server-side delete (only defects have a delete endpoint for now;
    // inspection-level photos can be re-managed by editing the DRAFT).
    if (parentKind !== 'defect') {
      // Optimistic local removal — backend cleanup not wired yet.
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      return;
    }
    try {
      await defects.deletePhoto(parentId, item.id);
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      onChanged?.('deleted', item);
    } catch (err) {
      alert(`Delete failed: ${err?.detail || err?.message || 'unknown'}`);
    }
  };

  // Hide "Add photo" tile if maxPhotos reached
  const reachedMax = maxPhotos != null && items.filter((x) => x.status === 'done' || x.status === 'compressing' || x.status === 'uploading').length >= maxPhotos;

  return (
    <div className="relative">
      {/*
        BUG MITIGATION (2026-05-15): removed `capture="environment"` to
        stop Android Chrome from killing the WebView when the OS camera
        intent fires. Reported on a Pixel-class Android: after taking
        the odometer photo the page reloaded and the inspection wizard
        landed back on the home view (state lost from RAM).

        Without `capture`, mobile browsers show the standard picker
        ("Take photo / Choose from gallery") which keeps the WebView
        alive — one extra tap, but no eviction risk.
      */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          handlePicked(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Inline success toast — auto-dismisses in ~2 s */}
      <AnimatePresence>
        {successCount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="mb-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-green/15 border border-accent-green/40 text-accent-green text-[11px] font-semibold"
          >
            <Check size={12} />
            {successCount === 1
              ? 'Photo uploaded successfully'
              : `${successCount} photos uploaded`}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {items.map((p, i) => (
          <motion.div
            key={p.id || p.tempId || i}
            // Brief celebration when the upload just completed: green ring +
            // gentle scale pulse for 600 ms.
            animate={p.justCompletedAt ? {
              boxShadow: [
                '0 0 0 0 rgba(34,197,94,0)',
                '0 0 0 4px rgba(34,197,94,0.5)',
                '0 0 0 0 rgba(34,197,94,0)',
              ],
              scale: [1, 1.03, 1],
            } : {}}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="relative aspect-square rounded-lg overflow-hidden border border-navy-700 bg-navy-900"
          >
            <img
              src={p.url || p.preview}
              alt=""
              className={`w-full h-full object-cover ${
                p.status !== 'done' ? 'opacity-60' : ''
              }`}
              loading="lazy"
            />

            {/* Overlays */}
            {p.status === 'compressing' && (
              <Overlay>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full"
                />
                <span className="text-[10px] text-white font-semibold">{t('photoUploader.compressing', 'Compressing')}</span>
              </Overlay>
            )}
            {p.status === 'uploading' && (
              <Overlay>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="w-5 h-5 border-2 border-accent-blue/40 border-t-accent-blue rounded-full"
                />
                <span className="text-[10px] text-white font-semibold">{t('photoUploader.uploading', 'Uploading')}</span>
              </Overlay>
            )}
            {p.status === 'error' && (
              <Overlay>
                <AlertCircle size={18} className="text-accent-red" />
                <span className="text-[10px] text-accent-red font-semibold text-center px-1">
                  {p.error?.slice(0, 40) || 'Failed'}
                </span>
                <button
                  onClick={() => handleRetry(p)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent-red/20 border border-accent-red/40 text-accent-red text-[10px] hover:bg-accent-red/30 cursor-pointer"
                >
                  <RotateCcw size={10} /> Retry
                </button>
              </Overlay>
            )}
            {p.status === 'done' && !readOnly && (
              <button
                onClick={() => handleDelete(p)}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white hover:bg-black/80 flex items-center justify-center cursor-pointer"
                title={t('photoUploader.deleteTitle')}
              >
                <X size={12} />
              </button>
            )}
            {p.status === 'done' && (
              <motion.div
                initial={p.justCompletedAt ? { scale: 0 } : false}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                className={`absolute bottom-1 right-1 rounded-full bg-accent-green text-white flex items-center justify-center transition-all ${
                  p.justCompletedAt
                    ? 'w-7 h-7 ring-2 ring-accent-green/50'
                    : 'w-5 h-5'
                }`}
                title={t('photoUploader.synced', 'Synced')}
              >
                <Check size={p.justCompletedAt ? 16 : 11} strokeWidth={3} />
              </motion.div>
            )}
          </motion.div>
        ))}

        {/* Add-photo tile */}
        {!readOnly && !reachedMax && (
          <button
            onClick={() => inputRef.current?.click()}
            className="aspect-square rounded-lg border-2 border-dashed border-navy-600 hover:border-accent-blue hover:bg-accent-blue/5 flex flex-col items-center justify-center gap-1 text-navy-400 hover:text-accent-blue cursor-pointer transition-colors"
            title={t('photoUploader.takeOrChoose', 'Take photo or choose from gallery')}
          >
            <Camera size={20} />
            <span className="text-[10px] font-semibold">{t('photoUploader.addPhoto', 'Add photo')}</span>
          </button>
        )}
      </div>

      {items.length === 0 && readOnly && (
        <div className="text-sm text-navy-500 italic px-3 py-4 text-center">
          No photos attached to this defect.
        </div>
      )}
    </div>
  );
}

function Overlay({ children }) {
  return (
    <div className="absolute inset-0 bg-navy-950/70 backdrop-blur-[1px] flex flex-col items-center justify-center gap-1.5">
      {children}
    </div>
  );
}

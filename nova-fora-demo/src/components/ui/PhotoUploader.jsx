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
import { useEffect, useRef, useState } from 'react';
import imageCompression from 'browser-image-compression';
import { motion } from 'framer-motion';
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
  // Each item: { id?, url?, preview?, status, error?, _retryFile?, tempId? }
  // - id/url come from the server after commit
  // - preview is a local blob URL for optimistic display
  // - status: 'compressing' | 'uploading' | 'done' | 'error'
  const [items, setItems] = useState(() =>
    initialPhotos.map((p) => ({ ...p, status: 'done' }))
  );
  const inputRef = useRef(null);

  // Keep local state in sync when parent refetches photos
  useEffect(() => {
    setItems(initialPhotos.map((p) => ({ ...p, status: 'done' })));
  }, [initialPhotos]);

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
              }
            : x
        )
      );
      // Release blob URL after a short delay so the swap isn't jarring
      setTimeout(() => URL.revokeObjectURL(preview), 1500);

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
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => {
          handlePicked(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {items.map((p, i) => (
          <div
            key={p.id || p.tempId || i}
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
                <span className="text-[10px] text-white font-semibold">Compressing</span>
              </Overlay>
            )}
            {p.status === 'uploading' && (
              <Overlay>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="w-5 h-5 border-2 border-accent-blue/40 border-t-accent-blue rounded-full"
                />
                <span className="text-[10px] text-white font-semibold">Uploading</span>
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
                title="Delete photo"
              >
                <X size={12} />
              </button>
            )}
            {p.status === 'done' && (
              <div
                className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-accent-green text-white flex items-center justify-center"
                title="Synced"
              >
                <Check size={11} />
              </div>
            )}
          </div>
        ))}

        {/* Add-photo tile */}
        {!readOnly && !reachedMax && (
          <button
            onClick={() => inputRef.current?.click()}
            className="aspect-square rounded-lg border-2 border-dashed border-navy-600 hover:border-accent-blue hover:bg-accent-blue/5 flex flex-col items-center justify-center gap-1 text-navy-400 hover:text-accent-blue cursor-pointer transition-colors"
            title="Take photo or choose from gallery"
          >
            <Camera size={20} />
            <span className="text-[10px] font-semibold">Add photo</span>
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

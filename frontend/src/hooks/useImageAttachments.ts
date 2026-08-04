import { useState } from "react";
import { ApiError, uploadProjectImage } from "@/lib/api";

export interface AttachedImage {
  id: string;
  filename: string;
  path?: string;
  uploading: boolean;
  error?: string;
}

/** Shared upload/error/chip state machine for attaching images to a prompt — used by
 * ProjectPage's new-task composer and DiscussionView's reply composer alike, so both stay
 * in sync rather than drifting as two independent copies of the same logic. */
export function useImageAttachments(projectId: string | undefined) {
  const [images, setImages] = useState<AttachedImage[]>([]);

  function handleFilesSelected(fileList: FileList | null) {
    if (!projectId || !fileList) return;
    for (const file of fileList) {
      const id = crypto.randomUUID();
      setImages((prev) => [...prev, { id, filename: file.name, uploading: true }]);
      uploadProjectImage(projectId, file)
        .then(({ path }) => {
          setImages((prev) => prev.map((img) => (img.id === id ? { ...img, path, uploading: false } : img)));
        })
        .catch((err: unknown) => {
          const message = err instanceof ApiError ? err.message : "Upload failed.";
          setImages((prev) => prev.map((img) => (img.id === id ? { ...img, uploading: false, error: message } : img)));
        });
    }
  }

  function removeImage(id: string) {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }

  function reset() {
    setImages([]);
  }

  return {
    images,
    handleFilesSelected,
    removeImage,
    reset,
    imagePaths: images.flatMap((img) => (img.path ? [img.path] : [])),
    imagesStillUploading: images.some((img) => img.uploading),
  };
}

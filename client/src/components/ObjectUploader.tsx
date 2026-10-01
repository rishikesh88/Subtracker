import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

/** One uploaded file, in the shape the callers already read. */
export interface UploadedFile {
  name: string;
  type: string;
  size: number;
  /** The storage address without the signature (what the server normalises). */
  uploadURL: string;
}

export interface UploadResult {
  successful: UploadedFile[];
  failed: { name: string; error: string }[];
}

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  allowedFileTypes?: string[];
  onGetUploadParameters: () => Promise<{
    method: "PUT";
    url: string;
  }>;
  onComplete?: (result: UploadResult) => void;
  onError?: (message: string) => void;
  buttonClassName?: string;
  children: ReactNode;
}

/**
 * Uploads invoice files to object storage through a presigned PUT.
 *
 * The button opens the operating system's file picker and starts the upload
 * as soon as something is chosen.
 *
 * The PUT is a plain fetch, not Uppy. Uppy's S3 uploader insists on reading
 * the ETag response header and, when the bucket's CORS rule does not expose
 * it, stops without ever finishing or failing: the button sat on "Uploading"
 * and nothing was saved. A PUT needs nothing back from the bucket, so there
 * is nothing here that depends on how its CORS is set beyond allowing PUT.
 */
export function ObjectUploader({
  maxNumberOfFiles = 10,
  maxFileSize = 10485760, // 10MB default
  allowedFileTypes = ['.pdf', '.png', '.jpg', '.jpeg', '.docx', '.doc'],
  onGetUploadParameters,
  onComplete,
  onError,
  buttonClassName,
  children,
}: ObjectUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const extensionOf = (name: string) => {
    const dot = name.lastIndexOf('.');
    return dot < 0 ? '' : name.slice(dot).toLowerCase();
  };

  const uploadOne = async (file: File): Promise<UploadedFile> => {
    const { url } = await onGetUploadParameters();
    const response = await fetch(url, {
      method: 'PUT',
      body: file,
      headers: file.type ? { 'Content-Type': file.type } : undefined,
    });
    if (!response.ok) {
      throw new Error(`Storage answered ${response.status}`);
    }
    return {
      name: file.name,
      type: file.type,
      size: file.size,
      uploadURL: url.split('?')[0],
    };
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    // Reset so choosing the same file twice in a row still fires onChange.
    e.target.value = '';
    if (picked.length === 0) return;

    if (picked.length > maxNumberOfFiles) {
      onError?.(`You can upload up to ${maxNumberOfFiles} files at a time`);
      return;
    }

    const allowed = allowedFileTypes.map((t) => t.toLowerCase());
    const files: File[] = [];
    for (const file of picked) {
      if (allowed.length > 0 && !allowed.includes(extensionOf(file.name))) {
        onError?.(`${file.name} is not a supported file type`);
      } else if (file.size > maxFileSize) {
        onError?.(`${file.name} is larger than ${Math.round(maxFileSize / 1048576)} MB`);
      } else {
        files.push(file);
      }
    }
    if (files.length === 0) return;

    setIsUploading(true);
    const result: UploadResult = { successful: [], failed: [] };
    for (const file of files) {
      try {
        result.successful.push(await uploadOne(file));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        result.failed.push({ name: file.name, error: message });
        onError?.(`${file.name}: ${message}`);
      }
    }
    setIsUploading(false);
    onComplete?.(result);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
        className={buttonClassName}
        data-testid="upload-invoice-btn"
      >
        {isUploading ? (
          <>
            <Loader2 size={15} strokeWidth={2} className="animate-spin" />
            Uploading…
          </>
        ) : (
          children
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple={maxNumberOfFiles > 1}
        accept={allowedFileTypes?.join(',')}
        onChange={handleFileSelect}
        className="hidden"
        data-testid="input-file-select"
      />
    </>
  );
}

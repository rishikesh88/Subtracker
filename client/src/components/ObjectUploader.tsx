import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Uppy from "@uppy/core";
import AwsS3 from "@uppy/aws-s3";
import type { UploadResult } from "@uppy/core";
import { Loader2 } from "lucide-react";

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  allowedFileTypes?: string[];
  onGetUploadParameters: () => Promise<{
    method: "PUT";
    url: string;
  }>;
  onComplete?: (
    result: UploadResult<Record<string, unknown>, Record<string, unknown>>
  ) => void;
  onError?: (message: string) => void;
  buttonClassName?: string;
  children: ReactNode;
}

/**
 * Uploads invoice files to object storage through a presigned PUT.
 *
 * The button opens the operating system's file picker and starts the upload
 * as soon as something is chosen. It used to open a dialog that held a second
 * button that opened the picker -- two windows to do one thing. The picker is
 * already a file browser, so there was nothing for the dialog to add.
 *
 * Uppy stays because the presigned-URL flow and the uploadURL that the caller
 * reads back off the result both come from it.
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
  const uppyRef = useRef<Uppy | null>(null);

  if (!uppyRef.current) {
    uppyRef.current = new Uppy({
      restrictions: { maxNumberOfFiles, maxFileSize, allowedFileTypes },
      // Chosen means upload. There is no review step to wait for any more.
      autoProceed: true,
    }).use(AwsS3, {
      shouldUseMultipart: false,
      getUploadParameters: onGetUploadParameters,
    });
  }

  const uppy = uppyRef.current;

  const handleUploadStart = useCallback(() => setIsUploading(true), []);

  const handleComplete = useCallback(
    (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
      setIsUploading(false);
      onComplete?.(result);
      // Clear the queue so the next pick starts from nothing rather than
      // re-uploading what was chosen last time.
      uppy.cancelAll();
    },
    [uppy, onComplete]
  );

  // A file Uppy refuses -- too large, wrong type -- never reaches 'upload',
  // so without this the button would sit there and nothing would be said.
  const handleRestrictionFailed = useCallback(
    (_file: unknown, error: Error) => {
      setIsUploading(false);
      onError?.(error.message);
    },
    [onError]
  );

  const handleError = useCallback(
    (error: Error) => {
      setIsUploading(false);
      onError?.(error.message);
    },
    [onError]
  );

  useEffect(() => {
    uppy.on('upload', handleUploadStart);
    uppy.on('complete', handleComplete);
    uppy.on('restriction-failed', handleRestrictionFailed);
    uppy.on('error', handleError);

    return () => {
      uppy.off('upload', handleUploadStart);
      uppy.off('complete', handleComplete);
      uppy.off('restriction-failed', handleRestrictionFailed);
      uppy.off('error', handleError);
    };
  }, [uppy, handleUploadStart, handleComplete, handleRestrictionFailed, handleError]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    selected.forEach((file) => {
      try {
        uppy.addFile({ name: file.name, type: file.type, data: file });
      } catch (err) {
        // addFile throws on a restriction; 'restriction-failed' has already
        // reported it to the caller, so there is nothing to add here.
        console.error('Error adding file:', err);
      }
    });
    // Reset so choosing the same file twice in a row still fires onChange.
    e.target.value = '';
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

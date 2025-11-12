import { useState, useEffect, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import Uppy from "@uppy/core";
import AwsS3 from "@uppy/aws-s3";
import type { UploadResult } from "@uppy/core";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, X, FileText } from "lucide-react";

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
  buttonClassName?: string;
  children: ReactNode;
}

/**
 * A file upload component for invoice files (PDFs, images, documents).
 * Uses custom UI with shadcn Dialog to avoid Uppy React import issues.
 */
export function ObjectUploader({
  maxNumberOfFiles = 10,
  maxFileSize = 10485760, // 10MB default
  allowedFileTypes = ['.pdf', '.png', '.jpg', '.jpeg', '.docx', '.doc'],
  onGetUploadParameters,
  onComplete,
  buttonClassName,
  children,
}: ObjectUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [isUploading, setIsUploading] = useState(false);

  const uppyRef = useRef<Uppy | null>(null);

  // Initialize Uppy instance once
  if (!uppyRef.current) {
    uppyRef.current = new Uppy({
      restrictions: {
        maxNumberOfFiles,
        maxFileSize,
        allowedFileTypes,
      },
      autoProceed: false,
    }).use(AwsS3, {
      shouldUseMultipart: false,
      getUploadParameters: onGetUploadParameters,
    });
  }

  const uppy = uppyRef.current;

  const handleFileAdded = useCallback(() => {
    setFiles(uppy.getFiles().map(f => f.data as File));
  }, [uppy]);

  const handleFileRemoved = useCallback(() => {
    setFiles(uppy.getFiles().map(f => f.data as File));
  }, [uppy]);

  const handleUploadProgress = useCallback((file: any, progress: any) => {
    if (file) {
      setUploadProgress(prev => ({
        ...prev,
        [file.id]: (progress.bytesUploaded / progress.bytesTotal) * 100
      }));
    }
  }, []);

  const handleUploadStart = useCallback(() => {
    setIsUploading(true);
  }, []);

  const handleComplete = useCallback((result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    setIsUploading(false);
    onComplete?.(result);
    setShowModal(false);
    uppy.cancelAll();
    setFiles([]);
    setUploadProgress({});
  }, [uppy, onComplete]);

  useEffect(() => {
    uppy.on('file-added', handleFileAdded);
    uppy.on('file-removed', handleFileRemoved);
    uppy.on('upload-progress', handleUploadProgress);
    uppy.on('upload', handleUploadStart);
    uppy.on('complete', handleComplete);

    return () => {
      uppy.off('file-added', handleFileAdded);
      uppy.off('file-removed', handleFileRemoved);
      uppy.off('upload-progress', handleUploadProgress);
      uppy.off('upload', handleUploadStart);
      uppy.off('complete', handleComplete);
    };
  }, [uppy, handleFileAdded, handleFileRemoved, handleUploadProgress, handleUploadStart, handleComplete]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    selectedFiles.forEach(file => {
      try {
        uppy.addFile({
          name: file.name,
          type: file.type,
          data: file,
        });
      } catch (err) {
        console.error('Error adding file:', err);
      }
    });
  };

  const handleUpload = () => {
    uppy.upload();
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div>
      <Button onClick={() => setShowModal(true)} className={buttonClassName} data-testid="upload-invoice-btn">
        {children}
      </Button>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Upload Files</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div
              className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Click to select files or drag and drop
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {allowedFileTypes 
                  ? `Allowed types: ${allowedFileTypes.join(', ')}`
                  : 'All file types allowed'
                }
              </p>
              <p className="text-xs text-muted-foreground">
                Max file size: {formatFileSize(maxFileSize)}
              </p>
              <input
                id="file-input"
                type="file"
                multiple={maxNumberOfFiles > 1}
                accept={allowedFileTypes?.join(',')}
                onChange={handleFileSelect}
                className="hidden"
                data-testid="input-file-select"
              />
            </div>

            {files.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Selected Files</h4>
                {files.map((file, index) => {
                  const uppyFile = uppy.getFiles().find(f => f.name === file.name);
                  const progress = uppyFile ? uploadProgress[uppyFile.id] : 0;
                  
                  return (
                    <div key={index} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center space-x-3 flex-1 min-w-0">
                        <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(file.size)}
                          </p>
                          {isUploading && progress > 0 && (
                            <div className="mt-2">
                              <div className="w-full bg-secondary rounded-full h-1.5">
                                <div 
                                  className="bg-primary h-1.5 rounded-full transition-all"
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      {!isUploading && uppyFile && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => uppy.removeFile(uppyFile.id)}
                          data-testid={`button-remove-file-${index}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex justify-end space-x-2">
              <Button 
                variant="outline" 
                onClick={() => setShowModal(false)}
                disabled={isUploading}
                data-testid="button-cancel-upload"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleUpload}
                disabled={files.length === 0 || isUploading}
                data-testid="button-start-upload"
              >
                {isUploading ? 'Uploading...' : `Upload ${files.length} file${files.length !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

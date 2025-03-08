'use client';

import { useState, useRef, DragEvent, ChangeEvent } from 'react';
import Image from 'next/image';
import type { PDFDocumentProxy } from 'pdfjs-dist';

// Utility types
type FileStatus = 'idle' | 'processing' | 'uploading' | 'success' | 'error';
type PreviewFile = {
  file: File;
  previewUrl: string;
};

// Utility functions
function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf';
}

async function createImagePreview(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

// File conversion utilities
async function convertHeicToJpeg(file: File): Promise<File> {
  try {
    const { default: heic2any } = await import('heic2any');
    const convertedBlob = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.8
    });
    
    // Ensure convertedBlob is an array if it isn't already
    const blobArray = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
    
    return new File([blobArray], file.name.replace(/\.(heic|heif)$/i, '.jpg'), {
      type: 'image/jpeg'
    });
  } catch (error) {
    console.error('HEIC conversion failed:', error);
    throw new Error('Failed to convert HEIC image');
  }
}

// @ts-expect-error - PDFjs conversion function
async function convertPdfToJpeg(file: File): Promise<File> {
  if (typeof window === 'undefined') {
    throw new Error('PDF conversion can only happen in browser');
  }

  try {
    const pdfjsLib = await import('pdfjs-dist/webpack');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(new Uint8Array(arrayBuffer)).promise;
    const page = await pdf.getPage(1);

    // Create canvas
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not get canvas context');

    const viewport = page.getViewport({ scale: 2.0 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Set white background
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Render PDF page to canvas
    await page.render({
      canvasContext: context,
      viewport: viewport,
      background: 'white'
    }).promise;

    // Convert to JPEG
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to convert PDF to image'));
        },
        'image/jpeg',
        0.95
      );
    });

    return new File([blob], file.name.replace(/\.pdf$/i, '.jpg'), {
      type: 'image/jpeg'
    });
  } catch (error) {
    console.error('PDF conversion failed:', error);
    throw new Error('Failed to convert PDF');
  }
}

// Add new type for upload history
type UploadedFile = {
  id: string;
  previewUrl: string;
  fileName: string;
  timestamp: Date;
};

// Add new type for selected image
type SelectedImage = {
  url: string;
  fileName: string;
} | null;

export default function Home() {
  const [fileStatus, setFileStatus] = useState<FileStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadHistory, setUploadHistory] = useState<UploadedFile[]>([]);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [selectedImage, setSelectedImage] = useState<SelectedImage>(null);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await processAndUploadFile(files[0]);
    }
  };

  const handleFileInput = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await processAndUploadFile(files[0]);
    }
  };

  const processAndUploadFile = async (file: File) => {
    try {
      setFileStatus('processing');
      setErrorMessage('');
      setPreviewFile(null);

      // Validate file size
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
      if (file.size > MAX_FILE_SIZE) {
        throw new Error('File size exceeds 10MB limit');
      }

      // Process file based on type
      let processedFile: File;
      const fileName = file.name.toLowerCase();

      if (fileName.endsWith('.heic') || fileName.endsWith('.heif')) {
        processedFile = await convertHeicToJpeg(file);
      } else if (isPdfFile(file)) {
        processedFile = await convertPdfToJpeg(file);
      } else if (isImageFile(file)) {
        if (file.type === 'image/jpeg' || file.type === 'image/png') {
          processedFile = file;
        } else {
          // Convert other image formats to JPEG
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const img = document.createElement('img');
          
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
          });
          
          canvas.width = img.width;
          canvas.height = img.height;
          ctx!.drawImage(img, 0, 0);
          
          const blob = await new Promise<Blob>((resolve) => {
            canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.8);
          });
          
          processedFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
            type: 'image/jpeg'
          });
        }
      } else {
        throw new Error('Unsupported file type');
      }

      // Create preview
      const previewUrl = await createImagePreview(processedFile);
      setPreviewFile({ file: processedFile, previewUrl });

      // Upload file
      setFileStatus('uploading');
      const formData = new FormData();
      formData.append('file', processedFile);
      formData.append('originalFileName', file.name);
      formData.append('processedFileName', processedFile.name);
      formData.append('fileType', processedFile.type);
      formData.append('fileSize', processedFile.size.toString());

      const response = await fetch(process.env.NEXT_PUBLIC_WEBHOOK_URL!, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Upload failed');
      
      // After successful upload, add to history
      setUploadHistory(prev => [{
        id: Math.random().toString(36).substring(7),
        previewUrl: previewUrl,
        fileName: processedFile.name,
        timestamp: new Date()
      }, ...prev]);

      setFileStatus('success');
      setTimeout(() => {
        setFileStatus('idle');
        setPreviewFile(null); // Clear preview after success
      }, 3000);
    } catch (error) {
      console.error('Processing/Upload error:', error);
      setFileStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  };

  const handleImageClick = (url: string, fileName: string) => {
    setSelectedImage({ url, fileName });
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-6xl mx-auto p-6 py-12">
        <h1 className="text-4xl font-bold text-gray-800 mb-12 text-center tracking-tight">
          Nuway Receipt Uploader
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Upload Section */}
          <div className="space-y-6">
            <div
              className={`
                relative overflow-hidden
                rounded-2xl border-2 border-dashed p-12
                transition-all duration-300 ease-in-out
                bg-white backdrop-blur-sm
                ${isDragging ? 'border-blue-500 bg-blue-50/50 scale-[0.99]' : 'border-gray-200 hover:border-gray-300'}
                ${fileStatus === 'processing' || fileStatus === 'uploading' ? 'opacity-50 pointer-events-none' : ''}
                cursor-pointer group
              `}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileInput}
                accept="image/*,.heic,.heif,.pdf"
                className="hidden"
              />
              
              <div className="flex flex-col items-center gap-6">
                {previewFile ? (
                  <div className="relative w-56 h-56 rounded-xl overflow-hidden shadow-lg transition-transform duration-300 group-hover:scale-105">
                    <Image
                      src={previewFile.previewUrl}
                      alt="Preview"
                      fill
                      className="object-cover"
                    />
                  </div>
                ) : (
                  <div className="rounded-full bg-blue-50 p-6 transition-transform duration-300 group-hover:scale-110">
                    <Image
                      src="/upload-icon.svg"
                      alt="Upload"
                      width={48}
                      height={48}
                      className="opacity-70"
                    />
                  </div>
                )}
                
                <div className="text-center">
                  {fileStatus === 'processing' ? (
                    <p className="text-blue-600 animate-pulse flex items-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Processing file...
                    </p>
                  ) : fileStatus === 'uploading' ? (
                    <p className="text-blue-600 animate-pulse flex items-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Uploading...
                    </p>
                  ) : (
                    <>
                      <p className="text-xl font-medium text-gray-700 mb-2">
                        Drop your receipt here
                      </p>
                      <p className="text-sm text-gray-500">
                        or click to select
                      </p>
                      <p className="text-xs text-gray-400 mt-4 border border-gray-100 rounded-full px-4 py-2 inline-block">
                        Supports JPEG, PNG, HEIC, and PDF
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-4">
              <button
                className="flex-1 bg-gradient-to-br from-blue-500 to-blue-600 text-white py-4 px-6 rounded-xl
                  hover:from-blue-600 hover:to-blue-700 transition-all duration-300
                  disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:from-blue-500 disabled:hover:to-blue-600
                  flex items-center justify-center gap-3 shadow-md hover:shadow-lg active:scale-[0.98]"
                onClick={() => fileInputRef.current?.click()}
                disabled={fileStatus === 'processing' || fileStatus === 'uploading'}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Select File
              </button>

              <button
                className="flex-1 bg-gradient-to-br from-emerald-500 to-emerald-600 text-white py-4 px-6 rounded-xl
                  hover:from-emerald-600 hover:to-emerald-700 transition-all duration-300
                  disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:from-emerald-500 disabled:hover:to-emerald-600
                  flex items-center justify-center gap-3 shadow-md hover:shadow-lg active:scale-[0.98]"
                onClick={() => cameraInputRef.current?.click()}
                disabled={fileStatus === 'processing' || fileStatus === 'uploading'}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                    d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                    d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Take Photo
              </button>
              <input
                type="file"
                ref={cameraInputRef}
                onChange={handleFileInput}
                accept="image/*"
                capture="environment"
                className="hidden"
              />
            </div>

            {(fileStatus === 'success' || fileStatus === 'error') && (
              <div className={`
                rounded-xl p-4 text-center transition-all duration-300 animate-fade-in
                ${fileStatus === 'success' 
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                  : 'bg-red-50 text-red-700 border border-red-100'}
              `}>
                {fileStatus === 'success' ? 'Upload successful!' : errorMessage || 'Upload failed. Please try again.'}
              </div>
            )}
          </div>

          {/* Upload History Section */}
          <div className="bg-white rounded-2xl p-8 shadow-xl border border-gray-100/50 backdrop-blur-sm">
            <h2 className="text-2xl font-semibold text-gray-800 mb-6 flex items-center gap-3">
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Upload History
            </h2>
            {uploadHistory.length === 0 ? (
              <div className="text-center py-12 text-gray-400 bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
                <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
                <p>No uploads yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-h-[600px] overflow-y-auto pr-2 -mr-2">
                {uploadHistory.map((item) => (
                  <div 
                    key={item.id} 
                    className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 shadow-md 
                      transition-all duration-300 hover:shadow-xl hover:scale-[1.02] group cursor-pointer"
                    onClick={() => handleImageClick(item.previewUrl, item.fileName)}
                  >
                    <Image
                      src={item.previewUrl}
                      alt={item.fileName}
                      fill
                      className="object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/0 to-transparent 
                      opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <div className="absolute bottom-0 left-0 right-0 p-3">
                        <p className="text-white text-sm font-medium truncate">
                          {item.fileName}
                        </p>
                        <p className="text-gray-300 text-xs">
                          {new Date(item.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Image Preview Modal */}
      {selectedImage && (
        <div 
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative max-w-5xl w-full max-h-[90vh] bg-white rounded-2xl overflow-hidden">
            <div className="absolute top-4 right-4 z-10">
              <button 
                className="bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors"
                onClick={() => setSelectedImage(null)}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="relative aspect-[4/3] w-full">
              <Image
                src={selectedImage.url}
                alt={selectedImage.fileName}
                fill
                className="object-contain"
              />
            </div>
            <div className="p-4 bg-white border-t">
              <p className="text-gray-700 font-medium">{selectedImage.fileName}</p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

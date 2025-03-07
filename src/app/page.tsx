'use client';

import { useState, useRef, DragEvent, ChangeEvent } from 'react';
import Image from 'next/image';

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
    
    return new File([convertedBlob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), {
      type: 'image/jpeg'
    });
  } catch (error) {
    console.error('HEIC conversion failed:', error);
    throw new Error('Failed to convert HEIC image');
  }
}

// At the top of the file, add this type declaration
declare global {
  interface Window {
    pdfjsLib: any;
  }
}

// Update the convertPdfToJpeg function
async function convertPdfToJpeg(file: File): Promise<File> {
  if (typeof window === 'undefined') {
    throw new Error('PDF conversion can only happen in browser');
  }

  try {
    // Import PDF.js
    const pdfjsLib = await import('pdfjs-dist/webpack');
    // Set worker path
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

    // Load and render PDF
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

export default function Home() {
  const [fileStatus, setFileStatus] = useState<FileStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadHistory, setUploadHistory] = useState<UploadedFile[]>([]);
  const cameraInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto p-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-8 text-center">
          Receipt Upload
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Upload Section */}
          <div className="space-y-6">
            <div
              className={`
                relative overflow-hidden
                rounded-xl border-2 border-dashed p-8
                transition-all duration-200 ease-in-out
                ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
                ${fileStatus === 'processing' || fileStatus === 'uploading' ? 'opacity-50 pointer-events-none' : ''}
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
              
              <div className="flex flex-col items-center gap-4">
                {previewFile ? (
                  <div className="relative w-48 h-48">
                    <Image
                      src={previewFile.previewUrl}
                      alt="Preview"
                      fill
                      className="object-contain rounded-lg"
                    />
                  </div>
                ) : (
                  <div className="rounded-full bg-blue-50 p-4">
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
                    <p className="text-blue-600 animate-pulse">Processing file...</p>
                  ) : fileStatus === 'uploading' ? (
                    <p className="text-blue-600 animate-pulse">Uploading...</p>
                  ) : (
                    <>
                      <p className="text-lg font-medium text-gray-700">
                        Drop your file here
                      </p>
                      <p className="text-sm text-gray-500 mt-1">
                        or click to select
                      </p>
                      <p className="text-xs text-gray-400 mt-2">
                        Supports JPEG, PNG, HEIC, and PDF
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-4">
              <button
                className="flex-1 bg-blue-600 text-white py-3 px-4 rounded-lg 
                  hover:bg-blue-700 transition-colors duration-200
                  disabled:opacity-50 disabled:cursor-not-allowed
                  flex items-center justify-center gap-2"
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
                className="flex-1 bg-green-600 text-white py-3 px-4 rounded-lg 
                  hover:bg-green-700 transition-colors duration-200
                  disabled:opacity-50 disabled:cursor-not-allowed
                  flex items-center justify-center gap-2"
                onClick={() => {
                  if (cameraInputRef.current) {
                    cameraInputRef.current.click();
                  }
                }}
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
                rounded-lg p-4 text-center transition-all duration-200
                ${fileStatus === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}
              `}>
                {fileStatus === 'success' ? 'Upload successful!' : errorMessage || 'Upload failed. Please try again.'}
              </div>
            )}
          </div>

          {/* Upload History Section */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Upload History</h2>
            {uploadHistory.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No uploads yet
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {uploadHistory.map((item) => (
                  <div key={item.id} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100">
                    <Image
                      src={item.previewUrl}
                      alt={item.fileName}
                      fill
                      className="object-cover"
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 p-2">
                      <p className="text-white text-xs truncate">
                        {item.fileName}
                      </p>
                      <p className="text-gray-300 text-xs">
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

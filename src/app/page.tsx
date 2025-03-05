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

export default function Home() {
  const [fileStatus, setFileStatus] = useState<FileStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      
      setFileStatus('success');
      setTimeout(() => setFileStatus('idle'), 3000);
    } catch (error) {
      console.error('Processing/Upload error:', error);
      setFileStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  };

  return (
    <main className="min-h-screen p-4 flex flex-col items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-center mb-8 text-gray-800">
          File Upload
        </h1>

        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
            ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
            ${fileStatus === 'processing' || fileStatus === 'uploading' ? 'opacity-50 pointer-events-none' : ''}`}
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
            capture="environment"
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
              <Image
                src="/upload-icon.svg"
                alt="Upload"
                width={48}
                height={48}
                className="opacity-50"
              />
            )}
            
            <div className="text-gray-600">
              {fileStatus === 'processing' ? (
                <p>Processing file...</p>
              ) : fileStatus === 'uploading' ? (
                <p>Uploading...</p>
              ) : (
                <>
                  <p className="font-medium">Drop your file here</p>
                  <p className="text-sm mt-1">or click to select</p>
                  <p className="text-xs mt-2 text-gray-500">
                    Supports JPEG, PNG, HEIC, and PDF
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {fileStatus === 'success' && (
          <div className="mt-4 p-4 bg-green-100 text-green-700 rounded-lg text-center">
            Upload successful!
          </div>
        )}

        {fileStatus === 'error' && (
          <div className="mt-4 p-4 bg-red-100 text-red-700 rounded-lg text-center">
            {errorMessage || 'Upload failed. Please try again.'}
          </div>
        )}

        <button
          className="mt-4 w-full bg-blue-500 text-white py-3 px-4 rounded-lg hover:bg-blue-600 transition-colors
            disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => fileInputRef.current?.click()}
          disabled={fileStatus === 'processing' || fileStatus === 'uploading'}
        >
          {fileStatus === 'processing' ? 'Processing...' : 
           fileStatus === 'uploading' ? 'Uploading...' : 'Take a Photo'}
        </button>
      </div>
    </main>
  );
}

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

declare module 'heic2any' {
  interface Options {
    blob: Blob;
    toType?: string;
    quality?: number;
  }
  function heic2any(options: Options): Promise<Blob | Blob[]>;
  export default heic2any;
}

declare module 'pdfjs-dist/webpack' {
  import { PDFDocumentProxy, GlobalWorkerOptions } from 'pdfjs-dist';
  
  export const getDocument: (data: ArrayBuffer | Uint8Array) => Promise<PDFDocumentProxy>;
  export const GlobalWorkerOptions: {
    workerSrc: string;
  };
  export const version: string;
}

declare global {
  interface Window {
    pdfjsLib: {
      getDocument: (data: ArrayBuffer | Uint8Array) => Promise<PDFDocumentProxy>;
      GlobalWorkerOptions: {
        workerSrc: string;
      };
      version: string;
    };
  }
} 
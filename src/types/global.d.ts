declare module 'heic2any' {
  interface Options {
    blob: Blob;
    toType?: string;
    quality?: number;
  }
  function heic2any(options: Options): Promise<Blob | Blob[]>;
  export default heic2any;
}

declare module 'pdfjs-dist';

declare module 'pdfjs-dist/webpack';

declare module 'pdfjs-dist/build/pdf.worker.entry' {
  const workerEntry: string;
  export default workerEntry;
} 
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
  export * from 'pdfjs-dist';
} 
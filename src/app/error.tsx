'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Application error:', error);
  }, [error]);

  return (
    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
      <h2 className="text-red-800 font-medium">Something went wrong!</h2>
      <p className="text-red-600 mt-1">{error.message}</p>
      <button
        onClick={reset}
        className="mt-4 bg-red-100 text-red-700 px-4 py-2 rounded-md hover:bg-red-200"
      >
        Try again
      </button>
    </div>
  );
} 
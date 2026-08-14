import React, { useState } from 'react';

export default function PDFViewer({ url, token }) {
  const [loaded, setLoaded] = useState(false);

  const fullUrl = url.startsWith('http') 
    ? url 
    : `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token || '')}`;

  const viewerUrl = `/pdf-viewer.html?url=${encodeURIComponent(fullUrl)}`;

  return (
    <div className="w-full rounded-lg overflow-hidden bg-gray-100">
      {!loaded && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          <span className="ml-3 text-warm-500">正在加载文档...</span>
        </div>
      )}
      <iframe
        src={viewerUrl}
        className="w-full border-0"
        style={{ height: 'calc(100vh - 160px)', minHeight: '500px', display: loaded ? 'block' : 'none' }}
        title="文档预览"
        onLoad={() => setLoaded(true)}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}

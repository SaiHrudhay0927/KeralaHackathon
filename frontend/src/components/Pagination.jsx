import React from 'react';

// Shared pager used by the Audit Log and Timeline tables.
// Shows a total count and Prev/Next controls (controls hidden when only one page).
export default function Pagination({ page, totalPages, total, onPage, label = 'items' }) {
  return (
    <div className="pager">
      <span className="mono">{total} {label}</span>
      {totalPages > 1 && (
        <div className="pager-controls">
          <button className="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            Prev
          </button>
          <span className="mono">Page {page} / {totalPages}</span>
          <button className="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}

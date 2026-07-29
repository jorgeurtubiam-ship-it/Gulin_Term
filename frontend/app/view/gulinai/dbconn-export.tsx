// SPDX-License-Identifier: Apache-2.0
// DBConn Export Utilities - XLSX, PDF, CSV, Markdown, Dashboard

export function exportToXLSX(results: { columns: string[]; rows: any[] }, title: string) {
    if (!results || !results.rows || results.rows.length === 0) return;
    try {
        const XLSX = (window as any).XLSX;
        if (XLSX) {
            const ws = XLSX.utils.json_to_sheet(results.rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Data');
            XLSX.writeFile(wb, `${title.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`);
            return;
        }
    } catch (e) {
        console.error('XLSX export error:', e);
    }
    // Fallback to CSV
    exportToCSV(results, title);
}

export function exportToCSV(results: { columns: string[]; rows: any[] }, title: string) {
    if (!results || !results.rows || results.rows.length === 0) return;
    const keys = results.columns;
    const csv = [
        keys.join(","),
        ...results.rows.map(row =>
            keys.map(k => `"${row[k] ?? ''}"`).join(",")
        )
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

export async function exportToPDF(title: string, results: { columns: string[]; rows: any[] } | null) {
    if (!results || !results.rows) return;
    try {
        const { default: jsPDF } = await import('jspdf');
        const { default: autoTable } = await import('jspdf-autotable');

        const doc = new jsPDF();
        doc.setFontSize(16);
        doc.text(title, 14, 20);

        const rows = results.rows.map(row =>
            results.columns.map(c => row[c])
        );

        autoTable(doc, {
            head: [results.columns],
            body: rows,
            startY: 30,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [88, 28, 135] }
        });
        doc.save(`${title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
    } catch (e) {
        console.error('PDF export error:', e);
    }
}

export function copyAsMarkdown(results: { columns: string[]; rows: any[] }) {
    if (!results || !results.rows) return;
    const header = `| ${results.columns.join(' | ')} |`;
    const sep = `| ${results.columns.map(() => '---').join(' | ')} |`;
    const body = results.rows.map(row =>
        `| ${results.columns.map(c => row[c] ?? '').join(' | ')} |`
    ).join('\n');
    const md = `${header}\n${sep}\n${body}`;
    navigator.clipboard.writeText(md);
}

import { useState } from "react";
import { Modal, Button, Badge, ErrorText } from "../../components/ui";
import { usePreviewImport, useCommitImport } from "./hooks";
import { TEMPLATE_URL } from "./importApi";

/** Trigger a browser download of a text file (used for the error report). */
function downloadText(filename, content, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * CSV bulk-import flow (spec 002). Three phases in one modal:
 *   upload → preview (advisory) → result.
 * Nothing is written until the owner confirms at the preview step.
 */
export default function ImportModal({ onClose }) {
  const [phase, setPhase] = useState("upload"); // upload | preview | result
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const previewMut = usePreviewImport();
  const commitMut = useCommitImport();

  async function handlePreview(e) {
    e.preventDefault();
    setError("");
    if (!file) return setError("Choose a CSV file first.");
    if (!/\.csv$/i.test(file.name)) return setError("Please choose a .csv file.");
    try {
      const text = await file.text();
      if (!text.trim()) return setError("That file is empty.");
      const data = await previewMut.mutateAsync({ text, filename: file.name });
      setPreview(data);
      setPhase("preview");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCommit() {
    setError("");
    try {
      const data = await commitMut.mutateAsync(preview.token);
      setResult(data);
      setPhase("result");
    } catch (err) {
      // A common case: the preview token expired before commit.
      setError(err.message);
    }
  }

  return (
    <Modal title="Import items from CSV" onClose={onClose} footer={renderFooter()}>
      {error && <div className="mb-3"><ErrorText>{error}</ErrorText></div>}
      {phase === "upload" && renderUpload()}
      {phase === "preview" && renderPreview()}
      {phase === "result" && renderResult()}
    </Modal>
  );

  function renderFooter() {
    if (phase === "upload") {
      return (
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="import-upload" disabled={previewMut.isPending}>
            {previewMut.isPending ? "Checking…" : "Upload & preview"}
          </Button>
        </>
      );
    }
    if (phase === "preview") {
      return (
        <>
          <Button variant="secondary" onClick={() => { setPhase("upload"); setError(""); }}>
            Back
          </Button>
          <Button onClick={handleCommit} disabled={commitMut.isPending || preview.summary.toCreate === 0}>
            {commitMut.isPending ? "Importing…" : `Import ${preview.summary.toCreate} valid row(s)`}
          </Button>
        </>
      );
    }
    return <Button onClick={onClose}>Done</Button>;
  }

  function renderUpload() {
    return (
      <form id="import-upload" onSubmit={handlePreview} className="space-y-4">
        <p className="text-sm text-fg-muted">
          Prepare your file from the template, then upload it. You'll see a preview of exactly
          what will be created before anything is saved.
        </p>
        <a
          href={TEMPLATE_URL}
          download
          className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:text-accent"
        >
          ↓ Download template CSV
        </a>
        <div className="rounded-md bg-muted p-3 text-xs text-fg-muted">
          Tip: in Excel, format the <span className="font-medium">sku</span> and number columns as
          <span className="font-medium"> Text</span>, and save as plain CSV. Prices are in rupees;
          leave <span className="font-medium">sku</span> blank to auto-generate one. To declare stock
          you already own, fill <span className="font-medium">openingStock</span> and
          <span className="font-medium"> openingUnitCost</span> together (both or neither) — the unit
          cost is what you paid each, in rupees.
        </div>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-fg-muted file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent hover:file:bg-indigo-100"
        />
      </form>
    );
  }

  function renderPreview() {
    const { summary, newCategories, rows } = preview;
    // Up to 10k rows can be previewed; render only the rows needing attention
    // (errors + warnings) in full, and summarize the clean ones (scalable + the
    // owner only needs to eyeball the problems before confirming).
    const attention = rows.filter((r) => r.status === "error" || r.warnings.length > 0);

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge tone="green">{summary.toCreate} to create</Badge>
          {summary.errors > 0 && <Badge tone="red">{summary.errors} error(s)</Badge>}
          {summary.newCategories > 0 && (
            <Badge tone="gray">{summary.newCategories} new categor{summary.newCategories === 1 ? "y" : "ies"}</Badge>
          )}
        </div>

        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          This preview is advisory — the final result is recomputed when you import (the catalogue
          could change in between). Nothing has been saved yet.
        </p>

        {newCategories.length > 0 && (
          <div className="text-sm text-fg-muted">
            <span className="font-medium text-fg-muted">New categories: </span>
            {newCategories.join(", ")}
          </div>
        )}

        {attention.length === 0 ? (
          <p className="text-sm text-green-700">
            All {summary.toCreate} row(s) are valid and ready to import.
          </p>
        ) : (
          <>
            <p className="text-sm text-fg-muted">
              {summary.toCreate} row(s) will be created. The rows below need attention:
            </p>
            <div className="max-h-72 overflow-y-auto rounded-md border border-line">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs uppercase tracking-wide text-fg-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Row</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {attention.map((r) => (
                    <tr key={r.rowNumber}>
                      <td className="px-3 py-2 tabular-nums text-fg-muted">{r.rowNumber}</td>
                      <td className="px-3 py-2 text-fg">{r.name || <span className="text-fg-subtle">—</span>}</td>
                      <td className="px-3 py-2">
                        {r.status === "error" ? <Badge tone="red">error</Badge> : <Badge tone="amber">warning</Badge>}
                      </td>
                      <td className="px-3 py-2 text-xs text-fg-muted">
                        {[...r.errors, ...r.warnings].join("; ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    );
  }

  function renderResult() {
    const { counts, errorReportCsv } = result;
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge tone="green">{counts.created} created</Badge>
          {counts.skipped > 0 && <Badge tone="red">{counts.skipped} skipped</Badge>}
          {counts.newCategories > 0 && <Badge tone="gray">{counts.newCategories} new categor{counts.newCategories === 1 ? "y" : "ies"}</Badge>}
        </div>
        <p className="text-sm text-fg-muted">
          {counts.created} item(s) imported.
          {counts.skipped > 0 ? ` ${counts.skipped} row(s) were skipped.` : ""}
        </p>
        {errorReportCsv && (
          <Button
            variant="secondary"
            onClick={() => downloadText("import-errors.csv", errorReportCsv)}
          >
            ↓ Download error report ({counts.skipped} row(s))
          </Button>
        )}
      </div>
    );
  }
}

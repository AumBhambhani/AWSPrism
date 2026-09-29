export default function EvidenceBox({
  fileName,
  onFileChange,
  evidenceLink,
  onLinkChange
}) {
  return (
    <div>
      <div className="upload-box">
        <div>Click to upload evidence file</div>
        <div className="muted">PDF, DOCX, PNG, XLSX up to 25MB</div>
        <div className="upload-meta">
          <input type="file" onChange={onFileChange} />
          {fileName ? <span className="file-pill">{fileName}</span> : null}
        </div>
      </div>
      <div style={{ marginTop: "12px" }}>
        <input
          className="input"
          placeholder="Or paste a link (SharePoint, Drive, Confluence...)"
          value={evidenceLink}
          onChange={(event) => onLinkChange(event.target.value)}
        />
      </div>
    </div>
  );
}

import React, { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import {
  addBusinessDays,
  chairDeanTemplateRows,
  downloadCsv,
  parseChairDeanCsvRows,
  parsePtRosterCsvRows,
  ptTemplateRows,
  summarizePtRosterReplace,
  toIsoDate,
} from "./adminOpsUtils";

function panelStat(label, value) {
  return (
    <div style={{ border: "1px solid var(--border-soft)", borderRadius: 12, padding: 10, background: "var(--bg-soft)" }}>
      <div style={{ fontSize: 12, color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ marginTop: 6, fontWeight: 800, fontSize: 18 }}>{value}</div>
    </div>
  );
}

function parseFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data || []),
      error: reject,
    });
  });
}

export default function AdminOperationsPanel({
  ui,
  activeTerm,
  chairAssignments,
  setChairAssignments,
  deanAssignments,
  setDeanAssignments,
  ptStaffingRows,
  setPtStaffingRows,
  divisionOptions,
  senderEmail,
  setSenderEmail,
}) {
  const [chairMessage, setChairMessage] = useState("");
  const [deanMessage, setDeanMessage] = useState("");
  const [ptMessage, setPtMessage] = useState("");
  const [ptSummary, setPtSummary] = useState(null);
  const [selectedDivision, setSelectedDivision] = useState(divisionOptions[0] || "");
  const chairInputRef = useRef(null);
  const deanInputRef = useRef(null);
  const ptInputRef = useRef(null);

  const closesAt = useMemo(() => toIsoDate(addBusinessDays(new Date(), 10)), []);

  const selectedDivisionRecipients = useMemo(() => {
    return ptStaffingRows.filter((row) => row.division === selectedDivision);
  }, [ptStaffingRows, selectedDivision]);

  async function handleChairDeanUpload(file, kind) {
    if (!file) return;
    const parsed = await parseFile(file);
    const result = parseChairDeanCsvRows(parsed, kind);
    const setter = kind === "chair" ? setChairAssignments : setDeanAssignments;
    const setMessage = kind === "chair" ? setChairMessage : setDeanMessage;
    if (result.errors.length) {
      setMessage(`Import blocked. ${result.errors[0]}${result.errors.length > 1 ? ` (+${result.errors.length - 1} more)` : ""}`);
      return;
    }
    setter(result.rows);
    setMessage(`Imported ${result.rows.length} ${kind === "chair" ? "chair" : "dean"} row(s). Current selectors and exports now reflect the upload.`);
  }

  async function handlePtUpload(file) {
    if (!file) return;
    const parsed = await parseFile(file);
    const result = parsePtRosterCsvRows(parsed);
    if (result.errors.length) {
      setPtSummary(null);
      setPtMessage(`Import blocked. ${result.errors[0]}${result.errors.length > 1 ? ` (+${result.errors.length - 1} more)` : ""}`);
      return;
    }

    const summary = summarizePtRosterReplace(ptStaffingRows, result.rows);
    setPtSummary(summary);

    const warningText = result.warnings?.length
      ? ` Warnings: ${result.warnings[0]}${result.warnings.length > 1 ? ` (+${result.warnings.length - 1} more)` : ""}`
      : "";

    const proceed = window.confirm(
      `Replace the active college-wide PT roster?\n\n` +
      `Incoming rows: ${summary.incomingCount}\n` +
      `Added: ${summary.added}\n` +
      `Updated: ${summary.updated}\n` +
      `Unchanged: ${summary.unchanged}\n` +
      `Marked inactive because missing from file: ${summary.inactivated}\n\n` +
      `Historical assignments and audit records will remain.`
    );

    if (!proceed) {
      setPtMessage(`Import canceled. Preview stayed at ${summary.incomingCount} incoming row(s).${warningText}`);
      return;
    }

    setPtStaffingRows(result.rows);
    setPtMessage(
      `Imported ${result.rows.length} active PT staffing row(s). ` +
      `${summary.inactivated} existing row(s) will be marked inactive because they were not included in the new file.` +
      warningText
    );
  }

  function handleWipePtRoster() {
    const count = ptStaffingRows.length;
    const proceed = window.confirm(
      `Mark all ${count} active PT roster row(s) inactive?\n\nHistorical assignments and audit records will remain.`
    );
    if (!proceed) return;
    setPtStaffingRows([]);
    setPtSummary({
      currentCount: count,
      incomingCount: 0,
      added: 0,
      updated: 0,
      unchanged: 0,
      inactivated: count,
    });
    setPtMessage(`Marked ${count} active PT roster row(s) inactive. Historical records remain intact.`);
  }

  return (
    <div style={ui.card}>
      <div style={ui.between}>
        <div>
          <h2 style={ui.cardTitle}>Admin Operations</h2>
          <div style={ui.cardDesc}>Directory imports now do real work, PT roster imports allow division-discipline duplicates, and dissemination settings can be edited before send.</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginTop: 14 }}>
        {panelStat("Chairs", chairAssignments.length)}
        {panelStat("Deans", deanAssignments.length)}
        {panelStat("PT roster rows", ptStaffingRows.length)}
        {panelStat("Division recipients", selectedDivisionRecipients.length)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16, marginTop: 16 }}>
        <div style={ui.sectionCard}>
          <div style={{ fontWeight: 800 }}>Chair Directory</div>
          <div style={{ color: "var(--text-muted)", marginTop: 6 }}>Email is required here because this directory will feed account identity and divisional dissemination later.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button style={ui.btn} onClick={() => downloadCsv("chair-directory-blank.csv", ["chairName", "email", "divisions"], [])}>Blank Template</button>
            <button style={ui.btn} onClick={() => downloadCsv("chair-directory-example.csv", ["chairName", "email", "divisions"], chairDeanTemplateRows("chair"))}>Example</button>
            <button style={ui.btn} onClick={() => downloadCsv("chair-directory-current.csv", ["chairName", "email", "divisions"], chairAssignments.map((row) => ({ ...row, divisions: (row.divisions || []).join("|") })))}>Current Export</button>
            <input ref={chairInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => handleChairDeanUpload(e.target.files?.[0], "chair")} />
            <button style={ui.btnPrimary} onClick={() => chairInputRef.current?.click()}>Import CSV</button>
          </div>
          {chairMessage ? <div style={{ marginTop: 10, color: chairMessage.startsWith("Imported") ? "#166534" : "#b91c1c", fontWeight: 700 }}>{chairMessage}</div> : null}
        </div>

        <div style={ui.sectionCard}>
          <div style={{ fontWeight: 800 }}>Dean Directory</div>
          <div style={{ color: "var(--text-muted)", marginTop: 6 }}>Same import behavior as chairs, with email stored alongside divisional coverage.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button style={ui.btn} onClick={() => downloadCsv("dean-directory-blank.csv", ["deanName", "email", "divisions"], [])}>Blank Template</button>
            <button style={ui.btn} onClick={() => downloadCsv("dean-directory-example.csv", ["deanName", "email", "divisions"], chairDeanTemplateRows("dean"))}>Example</button>
            <button style={ui.btn} onClick={() => downloadCsv("dean-directory-current.csv", ["deanName", "email", "divisions"], deanAssignments.map((row) => ({ ...row, divisions: (row.divisions || []).join("|") })))}>Current Export</button>
            <input ref={deanInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => handleChairDeanUpload(e.target.files?.[0], "dean")} />
            <button style={ui.btnPrimary} onClick={() => deanInputRef.current?.click()}>Import CSV</button>
          </div>
          {deanMessage ? <div style={{ marginTop: 10, color: deanMessage.startsWith("Imported") ? "#166534" : "#b91c1c", fontWeight: 700 }}>{deanMessage}</div> : null}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 16, marginTop: 16 }}>
        <div style={ui.sectionCard}>
          <div style={{ fontWeight: 800 }}>Part-Time Staffing Roster</div>
          <div style={{ color: "var(--text-muted)", marginTop: 6 }}>This is a college-wide master roster. Duplicate people are allowed as long as employee ID, division, and discipline stay distinct. Missing rows from a replacement upload will be marked inactive, not erased from history.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button style={ui.btn} onClick={() => downloadCsv("pt-staffing-blank.csv", ["employee_id", "first_name", "last_name", "email", "division", "discipline", "qualified_disciplines", "seniority_rank"], [])}>Blank Template</button>
            <button style={ui.btn} onClick={() => downloadCsv("pt-staffing-example.csv", ["employee_id", "first_name", "last_name", "email", "division", "discipline", "qualified_disciplines", "seniority_rank"], ptTemplateRows())}>Example</button>
            <button style={ui.btn} onClick={() => downloadCsv("pt-staffing-current.csv", ["employee_id", "first_name", "last_name", "email", "division", "discipline", "qualified_disciplines", "seniority_rank"], ptStaffingRows)}>Current Active Export</button>
            <input ref={ptInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => handlePtUpload(e.target.files?.[0])} />
            <button style={ui.btnPrimary} onClick={() => ptInputRef.current?.click()}>Replace College-Wide CSV</button>
            <button style={ui.btn} onClick={handleWipePtRoster}>Wipe Active Roster</button>
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: "var(--text-subtle)" }}>
            Required fields: employee_id, first_name, last_name, email, division, discipline. Recommended: qualified_disciplines, seniority_rank.
          </div>
          {ptSummary ? <div style={{ marginTop: 10, border: "1px solid var(--border-soft)", borderRadius: 12, padding: 12, background: "var(--bg-soft)" }}>
            <div style={{ fontWeight: 800 }}>Most Recent Replace Preview</div>
            <div style={{ marginTop: 6, fontSize: 14 }}>Incoming rows: {ptSummary.incomingCount}</div>
            <div style={{ marginTop: 4, fontSize: 14 }}>Added: {ptSummary.added}</div>
            <div style={{ marginTop: 4, fontSize: 14 }}>Updated: {ptSummary.updated}</div>
            <div style={{ marginTop: 4, fontSize: 14 }}>Unchanged: {ptSummary.unchanged}</div>
            <div style={{ marginTop: 4, fontSize: 14 }}>Will be marked inactive: {ptSummary.inactivated}</div>
          </div> : null}
          {ptMessage ? <div style={{ marginTop: 10, color: ptMessage.startsWith("Imported") || ptMessage.startsWith("Marked") ? "#166534" : "#b91c1c", fontWeight: 700 }}>{ptMessage}</div> : null}
        </div>

        <div style={ui.sectionCard}>
          <div style={{ fontWeight: 800 }}>Division Dissemination</div>
          <div style={{ color: "var(--text-muted)", marginTop: 6 }}>Set the sender address, choose one division at a time, and let the window auto-close in 10 business days.</div>
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <select style={ui.select} value={selectedDivision} onChange={(e) => setSelectedDivision(e.target.value)}>
              {divisionOptions.map((division) => <option key={division} value={division}>{division}</option>)}
            </select>
            <input style={ui.input} value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} placeholder="Sender email" />
            <div style={{ border: "1px solid var(--border-soft)", borderRadius: 12, padding: 12, background: "var(--bg-soft)" }}>
              <div style={{ fontWeight: 700 }}>Preview</div>
              <div style={{ marginTop: 6, fontSize: 14 }}>Term: {activeTerm?.code}</div>
              <div style={{ marginTop: 4, fontSize: 14 }}>Division: {selectedDivision || "None selected"}</div>
              <div style={{ marginTop: 4, fontSize: 14 }}>Recipients: {selectedDivisionRecipients.length}</div>
              <div style={{ marginTop: 4, fontSize: 14 }}>Window close: {closesAt}</div>
              <div style={{ marginTop: 4, fontSize: 14 }}>From: {senderEmail || "(set sender email)"}</div>
            </div>
            <textarea readOnly style={{ ...ui.input, minHeight: 120, resize: "vertical" }} value={`Subject: ${activeTerm?.code || "Active term"} PT staffing window for ${selectedDivision || "selected division"}\n\nA staffing window is now open for ${selectedDivision || "the selected division"}. Please log into S.C.O.P.E. using your email and password to review available sections and submit preferences.\n\nThis window closes automatically on ${closesAt}.\n\nPortal access will use your email-based account.\n\nSender: ${senderEmail || "jacoba@cos.edu"}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

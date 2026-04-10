import React, { useMemo, useState } from "react";
import Papa from "papaparse";
import {
  addBusinessDays,
  buildDivisionEmailPreview,
  chairExampleRows,
  chairTemplateColumns,
  deanExampleRows,
  deanTemplateColumns,
  downloadCsv,
  formatLocalDateTime,
  ptRosterColumns,
  ptRosterExampleRows,
} from "./adminOpsUtils";

const panelCard = {
  border: "1px solid var(--border-color)",
  borderRadius: 20,
  padding: 18,
  background: "var(--bg-card)",
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
};

const sectionTitle = {
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-subtle)",
};

function parseCsvFile(file, callback) {
  if (!file) return;
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (result) => callback(result.data || []),
  });
}

export default function AdminOperationsPanel({
  decisionLogs,
  activeTerm,
  divisions,
  chairAssignments,
  deanAssignments,
  facultyRoster,
  divisionWindows,
  senderEmail,
  setSenderEmail,
  onCreateDivisionWindow,
  onImportChairDirectory,
  onImportDeanDirectory,
  onImportPtRoster,
}) {
  const [auditSearch, setAuditSearch] = useState("");
  const [auditTypeFilter, setAuditTypeFilter] = useState("ALL");
  const [auditSortKey, setAuditSortKey] = useState("created_at");
  const [auditSortDirection, setAuditSortDirection] = useState("desc");
  const [selectedDivision, setSelectedDivision] = useState(divisions[0] || "");
  const [windowNote, setWindowNote] = useState("Divisionally distributed staffing window. Login required.");

  const auditEventOptions = useMemo(
    () => Array.from(new Set((decisionLogs || []).map((entry) => entry.event_type).filter(Boolean))).sort(),
    [decisionLogs]
  );

  const filteredAuditRows = useMemo(() => {
    const rows = (decisionLogs || []).filter((entry) => {
      const typeMatch = auditTypeFilter === "ALL" || entry.event_type === auditTypeFilter;
      const haystack = [entry.created_at, entry.actor_name, entry.event_type, entry.discipline_code, entry.detail].join(" ").toLowerCase();
      const textMatch = !auditSearch || haystack.includes(auditSearch.toLowerCase());
      return typeMatch && textMatch;
    });
    const ordered = [...rows].sort((a, b) => {
      const aValue = String(a?.[auditSortKey] ?? "");
      const bValue = String(b?.[auditSortKey] ?? "");
      return auditSortDirection === "asc" ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
    });
    return ordered;
  }, [decisionLogs, auditSearch, auditTypeFilter, auditSortKey, auditSortDirection]);

  const divisionEmailPreview = useMemo(() => {
    const openedAt = new Date();
    const closesAt = addBusinessDays(openedAt, 10);
    return buildDivisionEmailPreview({
      division: selectedDivision || "Selected division",
      termName: activeTerm?.name || activeTerm?.code || "Active term",
      closesAt,
      senderEmail,
    });
  }, [selectedDivision, activeTerm, senderEmail]);

  const currentChairRows = chairAssignments.map((row) => ({
    chair_name: row.chairName,
    divisions: (row.divisions || []).join("|"),
  }));
  const currentDeanRows = deanAssignments.map((row) => ({
    dean_name: row.deanName,
    divisions: (row.divisions || []).join("|"),
  }));
  const currentPtRows = facultyRoster.map((row) => ({
    employee_id: row.employeeId,
    first_name: row.firstName,
    last_name: row.lastName,
    email: row.email,
    division: row.division || "",
    primary_discipline: row.primaryDiscipline || "",
    qualified_disciplines: row.qualifiedDisciplines || "",
    active_status: row.activeStatus || "active",
  }));

  const openedAtValue = formatLocalDateTime(new Date());
  const closesAtValue = formatLocalDateTime(addBusinessDays(new Date(), 10));

  return (
    <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
      <div style={panelCard}>
        <div style={sectionTitle}>Audit Control Center</div>
        <div style={{ marginTop: 8, fontSize: 20, fontWeight: 800 }}>Sortable audit ledger</div>
        <div style={{ marginTop: 6, color: "var(--text-muted)" }}>
          Search, sort, and export the decision trail without spelunking through cards.
        </div>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1.5fr 1fr 1fr 1fr auto", marginTop: 14, alignItems: "center" }}>
          <input style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid var(--border-soft)", background: "var(--bg-soft)" }} value={auditSearch} onChange={(e) => setAuditSearch(e.target.value)} placeholder="Search actor, event, discipline, or detail" />
          <select style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid var(--border-soft)", background: "var(--bg-soft)" }} value={auditTypeFilter} onChange={(e) => setAuditTypeFilter(e.target.value)}>
            <option value="ALL">All events</option>
            {auditEventOptions.map((eventType) => <option key={eventType} value={eventType}>{eventType.replace(/_/g, " ")}</option>)}
          </select>
          <select style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid var(--border-soft)", background: "var(--bg-soft)" }} value={auditSortKey} onChange={(e) => setAuditSortKey(e.target.value)}>
            <option value="created_at">Sort by timestamp</option>
            <option value="actor_name">Sort by actor</option>
            <option value="event_type">Sort by event</option>
            <option value="discipline_code">Sort by discipline</option>
            <option value="detail">Sort by detail</option>
          </select>
          <select style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid var(--border-soft)", background: "var(--bg-soft)" }} value={auditSortDirection} onChange={(e) => setAuditSortDirection(e.target.value)}>
            <option value="desc">Newest / Z-A</option>
            <option value="asc">Oldest / A-Z</option>
          </select>
          <button style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid var(--border-color)", background: "white", cursor: "pointer" }} onClick={() => downloadCsv(filteredAuditRows, `scope-audit-control-${activeTerm?.code || "term"}.csv`, ["created_at", "actor_name", "event_type", "discipline_code", "detail"])} disabled={!filteredAuditRows.length}>Export</button>
        </div>
        <div style={{ overflowX: "auto", marginTop: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {['Timestamp','Actor','Event','Discipline','Detail'].map((label) => (
                  <th key={label} style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border-soft)", color: "var(--text-subtle)" }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredAuditRows.slice(0, 250).map((entry) => (
                <tr key={entry.id}>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border-soft)" }}>{new Date(entry.created_at).toLocaleString()}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border-soft)" }}>{entry.actor_name}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border-soft)" }}>{String(entry.event_type || "").replace(/_/g, " ")}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border-soft)" }}>{entry.discipline_code || "All"}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border-soft)" }}>{entry.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <div style={panelCard}>
          <div style={sectionTitle}>Division Dissemination</div>
          <div style={{ marginTop: 8, fontSize: 20, fontWeight: 800 }}>Open staffing window by division</div>
          <div style={{ marginTop: 6, color: "var(--text-muted)" }}>Each window defaults to a 10 business day close. Email delivery stays divisional, not college-wide.</div>
          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <select style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid var(--border-soft)", background: "var(--bg-soft)" }} value={selectedDivision} onChange={(e) => setSelectedDivision(e.target.value)}>
              {divisions.map((division) => <option key={division} value={division}>{division}</option>)}
            </select>
            <input style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid var(--border-soft)", background: "var(--bg-soft)" }} value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} placeholder="Sending address" />
            <textarea style={{ width: "100%", minHeight: 72, padding: 10, borderRadius: 12, border: "1px solid var(--border-soft)", background: "var(--bg-soft)" }} value={windowNote} onChange={(e) => setWindowNote(e.target.value)} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              <div style={{ padding: 10, borderRadius: 12, background: "var(--bg-soft)" }}>
                <div style={{ color: "var(--text-subtle)", fontSize: 12 }}>Opens</div>
                <div style={{ marginTop: 6, fontWeight: 700 }}>{openedAtValue}</div>
              </div>
              <div style={{ padding: 10, borderRadius: 12, background: "var(--bg-soft)" }}>
                <div style={{ color: "var(--text-subtle)", fontSize: 12 }}>Auto closes</div>
                <div style={{ marginTop: 6, fontWeight: 700 }}>{closesAtValue}</div>
              </div>
            </div>
            <button style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid transparent", background: "linear-gradient(135deg, #2563eb, #1d4ed8)", color: "white", cursor: "pointer", fontWeight: 700 }} onClick={() => onCreateDivisionWindow({ division: selectedDivision, openedAt: new Date().toISOString(), closesAt: addBusinessDays(new Date(), 10).toISOString(), senderEmail, note: windowNote })} disabled={!selectedDivision}>Create division window</button>
          </div>
          <div style={{ marginTop: 14, padding: 12, borderRadius: 12, background: "var(--bg-soft)", whiteSpace: "pre-wrap", fontSize: 13 }}>{divisionEmailPreview}</div>
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {divisionWindows.map((windowRow) => (
              <div key={windowRow.id} style={{ padding: 10, borderRadius: 12, border: "1px solid var(--border-soft)" }}>
                <div style={{ fontWeight: 700 }}>{windowRow.division}</div>
                <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>{windowRow.termCode} • closes {new Date(windowRow.closesAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={panelCard}>
          <div style={sectionTitle}>Directory and roster bootstrap</div>
          <div style={{ marginTop: 8, fontSize: 20, fontWeight: 800 }}>Import / export templates</div>
          <div style={{ marginTop: 6, color: "var(--text-muted)" }}>This is the staging area for chair, dean, and PT roster files. It gives you blanks, examples, current exports, and import slots.</div>
          <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
            <div style={{ padding: 12, borderRadius: 12, background: "var(--bg-soft)" }}>
              <div style={{ fontWeight: 700 }}>Chair directory</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <button style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border-color)", background: "white", cursor: "pointer" }} onClick={() => downloadCsv([], "scope-chair-directory-template.csv", chairTemplateColumns)}>Blank template</button>
                <button style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border-color)", background: "white", cursor: "pointer" }} onClick={() => downloadCsv(chairExampleRows(), "scope-chair-directory-example.csv", chairTemplateColumns)}>Example</button>
                <button style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border-color)", background: "white", cursor: "pointer" }} onClick={() => downloadCsv(currentChairRows, "scope-chair-directory-current.csv", chairTemplateColumns)}>Export current</button>
              </div>
              <input style={{ marginTop: 10 }} type="file" accept=".csv" onChange={(e) => parseCsvFile(e.target.files?.[0], onImportChairDirectory)} />
            </div>
            <div style={{ padding: 12, borderRadius: 12, background: "var(--bg-soft)" }}>
              <div style={{ fontWeight: 700 }}>Dean directory</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <button style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border-color)", background: "white", cursor: "pointer" }} onClick={() => downloadCsv([], "scope-dean-directory-template.csv", deanTemplateColumns)}>Blank template</button>
                <button style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border-color)", background: "white", cursor: "pointer" }} onClick={() => downloadCsv(deanExampleRows(), "scope-dean-directory-example.csv", deanTemplateColumns)}>Example</button>
                <button style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border-color)", background: "white", cursor: "pointer" }} onClick={() => downloadCsv(currentDeanRows, "scope-dean-directory-current.csv", deanTemplateColumns)}>Export current</button>
              </div>
              <input style={{ marginTop: 10 }} type="file" accept=".csv" onChange={(e) => parseCsvFile(e.target.files?.[0], onImportDeanDirectory)} />
            </div>
            <div style={{ padding: 12, borderRadius: 12, background: "var(--bg-soft)" }}>
              <div style={{ fontWeight: 700 }}>Part-time staffing roster</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <button style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border-color)", background: "white", cursor: "pointer" }} onClick={() => downloadCsv([], "scope-pt-roster-template.csv", ptRosterColumns)}>Blank template</button>
                <button style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border-color)", background: "white", cursor: "pointer" }} onClick={() => downloadCsv(ptRosterExampleRows(), "scope-pt-roster-example.csv", ptRosterColumns)}>Example</button>
                <button style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border-color)", background: "white", cursor: "pointer" }} onClick={() => downloadCsv(currentPtRows, "scope-pt-roster-current.csv", ptRosterColumns)}>Export current</button>
              </div>
              <input style={{ marginTop: 10 }} type="file" accept=".csv" onChange={(e) => parseCsvFile(e.target.files?.[0], onImportPtRoster)} />
              <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 13 }}>Required columns: employee ID, first name, last name, email, division, primary discipline, qualified disciplines, and active status.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function addBusinessDays(startInput, businessDays = 10) {
  const date = new Date(startInput);
  let remaining = Number(businessDays) || 0;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  date.setHours(23, 59, 0, 0);
  return date;
}

export function formatLocalDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function csvEscape(value) {
  const safe = String(value ?? "");
  const escaped = safe.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

export function rowsToCsv(rows, columns) {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row?.[column] ?? "")).join(","));
  }
  return lines.join("\n");
}

export function downloadCsv(rows, fileName, columns) {
  const csv = rowsToCsv(rows, columns);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const chairTemplateColumns = ["chair_name", "divisions"];
export const deanTemplateColumns = ["dean_name", "divisions"];
export const ptRosterColumns = [
  "employee_id",
  "first_name",
  "last_name",
  "email",
  "division",
  "primary_discipline",
  "qualified_disciplines",
  "active_status",
];

export function chairExampleRows() {
  return [
    { chair_name: "Social Sciences Division Chair", divisions: "Social Sciences" },
    { chair_name: "Math & Engineering Division Chair", divisions: "Math & Engineering|Science" },
  ];
}

export function deanExampleRows() {
  return [
    { dean_name: "Social Sciences Dean", divisions: "Social Sciences|Business|Consumer/Family Studies" },
    { dean_name: "STEM Dean", divisions: "Math & Engineering|Science" },
  ];
}

export function ptRosterExampleRows() {
  return [
    {
      employee_id: "200001",
      first_name: "Avery",
      last_name: "Lopez",
      email: "avery.lopez@cos.edu",
      division: "Social Sciences",
      primary_discipline: "HIST",
      qualified_disciplines: "HIST|POLS",
      active_status: "active",
    },
    {
      employee_id: "200002",
      first_name: "Morgan",
      last_name: "Chen",
      email: "morgan.chen@cos.edu",
      division: "Science",
      primary_discipline: "BIOL",
      qualified_disciplines: "BIOL|MICR",
      active_status: "active",
    },
  ];
}

export function buildDivisionEmailPreview({ division, termName, closesAt, senderEmail }) {
  const closeText = closesAt ? new Date(closesAt).toLocaleString() : "the posted close date";
  return `Subject: ${division} part-time staffing window now open\n\nThe ${division} staffing window for ${termName} is now open in S.C.O.P.E.\n\nPlease log in with your email and password to review available sections and submit your preferences.\n\nThis window will close automatically on ${closeText}.\n\nPortal access: [S.C.O.P.E. login URL]\nSupport contact: ${senderEmail}`;
}

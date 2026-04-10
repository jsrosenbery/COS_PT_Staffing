export function addBusinessDays(startDate, businessDays) {
  const date = new Date(startDate);
  let remaining = Number(businessDays) || 0;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return date;
}

export function toIsoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function escapeCsv(value) {
  const safe = String(value ?? "");
  const escaped = safe.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

export function downloadCsv(filename, headers, rows) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsv(row?.[header] ?? "")).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function normalizeText(value) {
  return String(value ?? "").trim();
}

export function splitPipedValues(value) {
  return normalizeText(value)
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseChairDeanCsvRows(rows, kind) {
  const cleaned = [];
  const errors = [];
  rows.forEach((row, index) => {
    const name = normalizeText(row.chairName || row.deanName || row.name);
    const email = normalizeText(row.email);
    const divisions = splitPipedValues(row.divisions || row.division || row.division_list);
    if (!name) errors.push(`Row ${index + 2}: ${kind} name is required.`);
    if (!email) errors.push(`Row ${index + 2}: email is required.`);
    if (!divisions.length) errors.push(`Row ${index + 2}: at least one division is required.`);
    if (name && email && divisions.length) {
      cleaned.push(kind === "chair"
        ? { chairName: name, email, divisions }
        : { deanName: name, email, divisions }
      );
    }
  });
  return { rows: cleaned, errors };
}

export function parsePtRosterCsvRows(rows) {
  const cleaned = [];
  const errors = [];
  const warnings = [];
  const dedupeMap = new Map();
  let exactDuplicateCount = 0;

  rows.forEach((row, index) => {
    const employee_id = normalizeText(row.employee_id || row.employeeId);
    const first_name = normalizeText(row.first_name || row.firstName);
    const last_name = normalizeText(row.last_name || row.lastName);
    const email = normalizeText(row.email);
    const division = normalizeText(row.division);
    const discipline = normalizeText(row.discipline || row.primary_discipline);
    const seniority_rank = normalizeText(row.seniority_rank || row.seniority_value || row.rank);
    const qualified_disciplines = normalizeText(row.qualified_disciplines || row.all_qualified_disciplines || discipline);

    if (!employee_id) errors.push(`Row ${index + 2}: employee_id is required.`);
    if (!first_name) errors.push(`Row ${index + 2}: first_name is required.`);
    if (!last_name) errors.push(`Row ${index + 2}: last_name is required.`);
    if (!email) errors.push(`Row ${index + 2}: email is required.`);
    if (!division) errors.push(`Row ${index + 2}: division is required.`);
    if (!discipline) errors.push(`Row ${index + 2}: discipline is required.`);

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      warnings.push(`Row ${index + 2}: email does not appear to be valid.`);
    }

    if (!employee_id || !first_name || !last_name || !email || !division || !discipline) return;

    const key = `${employee_id}__${division}__${discipline}`.toLowerCase();
    const normalizedRow = {
      employee_id,
      first_name,
      last_name,
      email,
      division,
      discipline,
      qualified_disciplines,
      seniority_rank,
      active_status: "active",
    };

    if (dedupeMap.has(key)) {
      exactDuplicateCount += 1;
      warnings.push(`Row ${index + 2}: duplicate employee_id + division + discipline replaced the earlier row.`);
    }

    dedupeMap.set(key, normalizedRow);
  });

  cleaned.push(...dedupeMap.values());
  return {
    rows: cleaned,
    errors,
    warnings,
    exactDuplicateCount,
  };
}

export function summarizePtRosterReplace(currentRows = [], nextRows = []) {
  const toKey = (row) =>
    `${normalizeText(row.employee_id)}__${normalizeText(row.division)}__${normalizeText(row.discipline)}`.toLowerCase();

  const currentMap = new Map(currentRows.map((row) => [toKey(row), row]));
  const nextMap = new Map(nextRows.map((row) => [toKey(row), row]));

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let inactivated = 0;

  for (const [key, nextRow] of nextMap.entries()) {
    const currentRow = currentMap.get(key);
    if (!currentRow) {
      added += 1;
      continue;
    }
    const same =
      normalizeText(currentRow.first_name) === normalizeText(nextRow.first_name) &&
      normalizeText(currentRow.last_name) === normalizeText(nextRow.last_name) &&
      normalizeText(currentRow.email) === normalizeText(nextRow.email) &&
      normalizeText(currentRow.qualified_disciplines) === normalizeText(nextRow.qualified_disciplines) &&
      normalizeText(currentRow.seniority_rank ?? currentRow.seniority_value) === normalizeText(nextRow.seniority_rank) &&
      normalizeText(currentRow.active_status || "active") === "active";

    if (same) unchanged += 1;
    else updated += 1;
  }

  for (const key of currentMap.keys()) {
    if (!nextMap.has(key)) inactivated += 1;
  }

  return {
    currentCount: currentRows.length,
    incomingCount: nextRows.length,
    added,
    updated,
    unchanged,
    inactivated,
  };
}

export function buildInitialPtRoster(faculty = [], seniority = [], disciplines = []) {
  const disciplineById = new Map(disciplines.map((item) => [item.id, item]));
  return seniority.map((row) => {
    const facultyRow = faculty.find((item) => item.id === row.facultyId) || {};
    const disciplineRow = disciplineById.get(row.disciplineId) || {};
    return {
      employee_id: facultyRow.employeeId || "",
      first_name: facultyRow.firstName || "",
      last_name: facultyRow.lastName || "",
      email: facultyRow.email || "",
      division: disciplineRow.division || "",
      discipline: disciplineRow.code || row.disciplineId || "",
      qualified_disciplines: disciplineRow.coveredSubjects?.join("|") || disciplineRow.code || row.disciplineId || "",
      seniority_rank: row.rank ?? "",
    };
  });
}

export function chairDeanTemplateRows(kind) {
  return kind === "chair"
    ? [{ chairName: "Social Sciences Division Chair", email: "chair@cos.edu", divisions: "Social Sciences|Business" }]
    : [{ deanName: "Social Sciences Dean", email: "dean@cos.edu", divisions: "Social Sciences|Business" }];
}

export function ptTemplateRows() {
  return [{
    employee_id: "100001",
    first_name: "Jordan",
    last_name: "Smith",
    email: "j.smith@cos.edu",
    division: "Social Sciences",
    discipline: "HIST",
    qualified_disciplines: "HIST",
    seniority_rank: 1,
  }];
}

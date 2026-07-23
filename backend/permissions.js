const elevatedRoles = new Set(["admin", "chair", "dean"]);

export function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

export function isAdmin(req) {
  return req.auth?.authType === "api-token" || normalizeRole(req.auth?.user?.role) === "admin";
}

export function hasAnyRole(req, roles = []) {
  if (isAdmin(req)) return true;
  const role = normalizeRole(req.auth?.user?.role || req.auth?.role);
  return roles.map(normalizeRole).includes(role);
}

export function currentRole(req) {
  return normalizeRole(req.auth?.user?.role || req.auth?.role);
}

export function allowedDivisions(req) {
  if (isAdmin(req)) return [];
  return splitScope(req.auth?.user?.division);
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (hasAnyRole(req, roles)) return next();
    return res.status(403).json({ error: "You do not have permission to perform this action." });
  };
}

export function requireElevatedRole(req, res, next) {
  if (isAdmin(req) || elevatedRoles.has(currentRole(req))) return next();
  return res.status(403).json({ error: "Chair, dean, or admin access is required." });
}

export function requirePreferenceOwnerOrElevated(req, res, next) {
  if (isAdmin(req) || elevatedRoles.has(currentRole(req))) return next();
  const user = req.auth?.user;
  const facultyId = String(req.query?.facultyId || req.body?.facultyId || "").trim();
  const employeeId = String(req.body?.employeeId || "").trim();
  if (normalizeRole(user?.role) === "faculty" && user.employee_id && (facultyId === user.employee_id || employeeId === user.employee_id)) {
    return next();
  }
  return res.status(403).json({ error: "Faculty users can only manage their own preferences." });
}

export function splitScope(value) {
  return String(value || "")
    .split(/[|,;]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function requestedDivisions(req) {
  const values = [
    req.body?.division,
    req.body?.divisionName,
    ...(Array.isArray(req.body?.divisions) ? req.body.divisions : []),
    req.query?.division,
    req.query?.divisionName,
    ...String(req.query?.divisions || "").split("|"),
  ];
  return values.flatMap(splitScope);
}

export function requireDivisionScope(req, res, next) {
  if (isAdmin(req)) return next();
  const requested = requestedDivisions(req);
  if (!requested.length) return res.status(400).json({ error: "A division scope is required for this action." });
  const allowed = allowedDivisions(req);
  if (allowed.length && requested.every((division) => allowed.includes(division))) return next();
  return res.status(403).json({ error: "This action is outside your assigned division scope." });
}

export function scopeFilterForReq(req, requested = []) {
  const normalizedRequested = requested.flatMap(splitScope);
  if (isAdmin(req)) return normalizedRequested;
  const allowed = allowedDivisions(req);
  if (!allowed.length) return [];
  if (!normalizedRequested.length) return allowed;
  return normalizedRequested.filter((division) => allowed.includes(division));
}

export function requireScopedRead(req, res, next) {
  if (isAdmin(req)) return next();
  const allowed = allowedDivisions(req);
  if (!allowed.length) return res.status(403).json({ error: "No valid division scope is assigned to this account." });
  return next();
}

export function enforceFacultySelf(req, res, next) {
  if (isAdmin(req) || elevatedRoles.has(currentRole(req))) return next();
  const user = req.auth?.user;
  if (normalizeRole(user?.role) !== "faculty" || !user.employee_id) {
    return res.status(403).json({ error: "Faculty account ownership could not be verified." });
  }
  req.query.facultyId = user.employee_id;
  req.body.facultyId = user.employee_id;
  req.body.employeeId = user.employee_id;
  return next();
}

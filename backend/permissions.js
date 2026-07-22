const elevatedRoles = new Set(["admin", "chair", "dean"]);

export function isAdmin(req) {
  return req.auth?.authType === "api-token" || req.auth?.user?.role === "admin";
}

export function hasAnyRole(req, roles = []) {
  if (isAdmin(req)) return true;
  const role = req.auth?.user?.role || req.auth?.role || "";
  return roles.includes(role);
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (hasAnyRole(req, roles)) return next();
    return res.status(403).json({ error: "You do not have permission to perform this action." });
  };
}

export function requireElevatedRole(req, res, next) {
  if (isAdmin(req) || elevatedRoles.has(req.auth?.user?.role)) return next();
  return res.status(403).json({ error: "Chair, dean, or admin access is required." });
}

export function requirePreferenceOwnerOrElevated(req, res, next) {
  if (isAdmin(req) || elevatedRoles.has(req.auth?.user?.role)) return next();
  const user = req.auth?.user;
  const facultyId = String(req.query?.facultyId || req.body?.facultyId || "").trim();
  const employeeId = String(req.body?.employeeId || "").trim();
  if (user?.role === "faculty" && user.employee_id && (facultyId === user.employee_id || employeeId === user.employee_id)) {
    return next();
  }
  return res.status(403).json({ error: "Faculty users can only manage their own preferences." });
}

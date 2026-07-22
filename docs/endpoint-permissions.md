# Backend Endpoint Permission Matrix

API-token authentication is treated as bootstrap/admin access. It is intentionally documented as admin-equivalent for backend operations and should be distributed only as a server secret or temporary administrative bootstrap credential.

Division-scoped users must have an assigned division list. Chairs and deans with multiple divisions may access only those divisions. Omitting a division parameter must not broaden access; read endpoints derive allowed divisions from the authenticated account and write endpoints validate the target record's division from the database where possible.

| Endpoint | Class | Scope / Ownership |
| --- | --- | --- |
| `POST /api/auth/login` | public | Public credential exchange |
| `POST /api/auth/request-account` | public | Public account request |
| `POST /api/auth/password-reset/request` | public | Public reset request |
| `POST /api/auth/password-reset/complete` | public | Public token completion |
| `POST /api/auth/accept-invite` | public | Public invite token completion |
| `POST /api/auth/logout` | authenticated | Current session only |
| `GET /api/auth/me` | authenticated | Current session only |
| `GET /api/auth/account-requests` | admin | Admin/API-token |
| `GET /api/auth/users` | admin | Admin/API-token |
| `PATCH /api/auth/users/:id` | admin | Admin/API-token |
| `POST /api/auth/invite` | admin | Admin/API-token |
| `POST /api/auth/users/:id/resend-invite` | admin | Admin/API-token |
| `POST /api/auth/users/:id/password-reset` | admin | Admin/API-token |
| `POST /api/auth/account-requests/:id/approve` | admin | Admin/API-token |
| `POST /api/auth/account-requests/:id/reject` | admin | Admin/API-token |
| `GET /api/terms` | public/authenticated read | Public read exception |
| `POST /api/terms` | admin | Admin/API-token |
| `POST /api/terms/activate` | admin | Admin/API-token |
| `GET /api/subject-mapping*` | authenticated | Mapping read; not faculty/person sensitive |
| `POST /api/upload/subject-mapping` | admin | Admin/API-token |
| `POST /api/upload/schedule/preview` | chair/dean/admin | Division-scoped; supplied division required and validated |
| `POST /api/upload/schedule` | chair/dean/admin | Division-scoped; supplied division required and validated |
| `GET /api/available-sections` | authenticated | Division-scoped read derived from user divisions |
| `GET /api/division-statuses` | authenticated | Division-scoped read derived from user divisions |
| `GET /api/allocation-analysis` | chair/dean/admin | Division-scoped read derived from user divisions |
| `GET /api/contract-exception-reasons` | chair/dean/admin | No division data returned |
| `GET /api/decision-explanations` | chair/dean/admin | Division-scoped read derived from user divisions |
| `GET /api/decision-explanations/export.csv` | admin | Admin/API-token export |
| `GET /api/decision-explanations/print` | admin | Admin/API-token printable export |
| `POST /api/chair-decisions` | chair | Division-scoped write; target section division validated from DB |
| `GET /api/chair-workflow` | chair/dean/admin | Division-scoped read derived from user divisions |
| `GET /api/assignments` | chair/dean/admin | Division-scoped read derived from user divisions |
| `POST /api/assignments/submit` | chair | Division-scoped write |
| `POST /api/assignments/approve` | dean | Division-scoped write |
| `POST /api/assignments` | chair/dean/admin legacy | Target section division derived from DB |
| `DELETE /api/assignments/:id` | chair/dean/admin legacy | Target assignment section division derived from DB |
| `PUT /api/assignments/:id/reassign` | chair/dean/admin legacy | Target assignment section division derived from DB |
| `GET /api/preferences` | faculty/elevated | Faculty own-record-only unless chair/dean/admin |
| `POST /api/preferences` | faculty/elevated | Faculty employee ID derived from session unless elevated |
| `DELETE /api/preferences` | chair/dean/admin | Division-scoped write |
| `GET /api/preferences/export` | chair/dean/admin | Division-scoped export for elevated users |
| `GET /api/decision-logs` | chair/dean/admin | Division-scoped read derived from user divisions |
| `POST /api/preferences/wipe` | chair/dean/admin | Division-scoped write |
| `POST /api/dissemination/send` | chair/dean/admin | Division-scoped write |
| `GET /api/roles` | chair/dean/admin | Division-scoped read derived from user divisions |
| `POST /api/roles` | admin | Admin/API-token |
| `GET /api/pt-faculty` | authenticated | Division-scoped read derived from user divisions |
| `POST /api/pt-faculty` | admin | Admin/API-token |
| `DELETE /api/pt-faculty` | admin | Admin/API-token |
| `GET /api/windows` | chair/dean/admin | Division-scoped read derived from user divisions |
| `POST /api/windows` | chair/dean/admin | Division-scoped write should include target division |
| `POST /api/windows/freeze` | chair/dean/admin | Division-scoped write |
| `POST /api/windows/reopen` | admin | Admin/API-token plus explicit audit reason |
| `GET /api/audit` | chair/dean/admin | Elevated audit read; division filtering should be used for scoped review |
| `POST /api/audit` | chair/dean/admin/system | Server-authored actor fields |

System/internal-only behavior is represented by server-generated audit records and derived decision/preference snapshots. Clients must not be trusted for actor identity, role, or broad division scope.

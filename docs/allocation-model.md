# Part-Time Faculty Preference and Allocation Model

## Terminology

- **Term**: The staffing cycle being worked, such as `SP27`.
- **Division**: The administrative scope for schedule upload, preference dissemination, chair review, and dean approval.
- **Discipline**: The subject or staffing discipline used to match eligible sections to qualified part-time faculty.
- **Section**: A single schedule row or bundled instructional unit, keyed by `assignment_group_id`.
- **Eligible PT section**: A section whose uploaded instructor value is blank, `STAFF`, `TBA`, or another configured unassigned value.
- **Preference submission**: A faculty member's ranked list of selected eligible sections for a term.
- **Seniority rank**: The contractual ordering for faculty within the applicable discipline; lower numeric rank means more senior.
- **Candidate queue**: The ordered set of faculty who selected a section, sorted by seniority, then deterministic tie-breakers.
- **Award / assignment**: A tentative, chair-submitted, or dean-approved placement of one faculty member onto one section.
- **Bypass / exception**: A decision to assign a section to someone other than the highest-seniority available interested candidate.
- **Decision reconstruction**: The ability to explain why each candidate did or did not receive each selected section.

## Workflow Stages

1. **Schedule Upload**
   - An elevated user uploads a schedule/seating CSV for one term and division.
   - Rows are parsed into instructional bundles.
   - Only rows for the selected division are retained.
   - Only blank, `STAFF`, `TBA`, or configured unassigned instructor rows should be preference-eligible.

2. **Mapping and Roster Readiness**
   - Subject codes map to disciplines.
   - Active PT faculty rows must include division, discipline or qualified disciplines, and seniority rank.
   - Missing discipline mappings or seniority ranks should be treated as readiness blockers or review warnings.

3. **Preference Window**
   - Chairs/admins open a limited preference window and notify eligible faculty.
   - Faculty submit concurrently.
   - Each faculty member may select zero, one, or many eligible sections.
   - A submitted preference list is ranked `1..n`.
   - Historical submitted rows should remain reconstructable after later edits.

4. **Allocation Analysis**
   - After the window closes, each eligible section receives a candidate queue.
   - The queue contains only faculty who selected that section.
   - Queue order is seniority first, then preference rank, then stable identity tie-breakers.
   - Previously awarded sections are unavailable.
   - Faculty already awarded another time-conflicting or policy-limited section may be unavailable for remaining sections.

5. **Chair Review**
   - Chairs act from the candidate queues.
   - Awarding the highest-seniority available interested candidate is ordinary.
   - Awarding anyone else requires a defined exception code and written justification.
   - Other candidates and their original submitted preferences stay visible for explanation.

6. **Dean Approval**
   - Chair-submitted assignments advance to dean review.
   - Dean approval changes assignment status, but should not rewrite preferences.

7. **Audit and Reconstruction**
   - Uploads, dissemination, submissions, assignments, bypasses, reassignments, chair submissions, dean approvals, and releases should produce audit records.
   - The system should reconstruct each section's queue, assignment, bypass reason, and every candidate's status from immutable submissions plus assignment events.

## State Transitions

### Section

- `not_loaded` -> `loaded`
- `loaded` -> `preference_open`
- `preference_open` -> `preference_closed`
- `preference_closed` -> `tentatively_awarded`
- `tentatively_awarded` -> `chair_submitted`
- `chair_submitted` -> `dean_approved`
- `tentatively_awarded` -> `released`
- `released` -> `preference_closed`

### Preference Submission

- `draft` -> `submitted`
- `submitted` -> `superseded_by_later_submission`
- `submitted` -> `locked_historical_record`

The current implementation saves preferences by deleting the faculty member's prior rows and inserting the current list. That supports a current-state view, but it does not preserve a complete submission history.

### Assignment

- `none` -> `tentative`
- `tentative` -> `chair_submitted`
- `chair_submitted` -> `dean_approved`
- `tentative` -> `released`
- `tentative` -> `reassigned_with_reason`

The current implementation physically deletes assignment rows when unassigning and deletes/reinserts assignment rows when assigning a section. A reconstructable model should prefer status transitions or immutable events.

## Allocation Invariants

1. Faculty preferences are historical records and must not be deleted or rewritten as a side effect of allocation.
2. A section is eligible for preference selection only when the uploaded instructor is blank, `STAFF`, `TBA`, or an explicitly configured unassigned value.
3. A candidate queue for a section includes only faculty who selected that section.
4. Seniority is primary within a discipline. Preference rank does not allow a junior faculty member to leapfrog a senior interested candidate.
5. Preference rank is still meaningful for reconstructing faculty intent and for ordering a faculty member's own desired assignments.
6. Once a section is awarded, that section is unavailable to all remaining candidates.
7. If a senior candidate does not receive a selected section because they were assigned elsewhere, the section remains available to the next-highest interested candidate.
8. A bypass of the highest-seniority available interested candidate must include an allowed reason code and written justification.
9. Repeat analysis over the same input must produce identical candidate queues and recommendations.
10. Malformed preference ranks, duplicate ranks, and missing seniority must be visible as findings instead of silently changing the outcome.

## Exception Behavior

Configured exception codes should be explicit and enumerable. The initial domain analyzer recognizes:

- `continuity`: Continuity with an instructor who recently taught the course.
- `dual_enrollment_positioned`: A candidate is specially positioned for the assignment, such as a high-school instructor assigned to a dual-enrollment section.
- `configured_contractual_exception`: Another locally configured contractual exception.

For every exception, the record should include:

- assigned employee ID;
- bypassed top available candidate;
- exception code;
- written justification;
- actor;
- timestamp;
- section;
- term;
- division.

An assignment to a non-top candidate without both a recognized code and written justification should remain in an `exception_required` state.

## Examples

### Base Data

Faculty seniority in Biology:

| Seniority | Faculty | Employee ID |
| --- | --- | --- |
| 1 | Ava Andrews | F1 |
| 2 | Ben Baker | F2 |
| 3 | Cam Chen | F3 |
| 4 | Dee Diaz | F4 |
| 5 | Eli Evans | F5 |

Eligible sections:

| Section | Course | Notes |
| --- | --- | --- |
| S1 | BIOL 001 | Lecture |
| S2 | BIOL 002 | Lecture |
| S3 | BIOL 003 | Lab |
| S4 | BIOL 004 | Dual enrollment |
| S5 | BIOL 005 | Evening |
| S6 | BIOL 006 | Online |

Preferences:

| Faculty | Rank 1 | Rank 2 | Rank 3 | Rank 4 | Rank 5 | Rank 6 |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | S2 | S1 | S3 | S4 | S5 | S6 |
| F2 | S1 | S3 | S4 | S5 | S6 |  |
| F3 | S1 | S2 | S5 |  |  |  |
| F4 | S4 | S1 | S6 |  |  |  |
| F5 | S5 | S6 |  |  |  |  |

### Example: Senior Candidate Does Not Receive a Section

If F1 is awarded S2 first, then F1 is unavailable for S1 under a one-assignment or conflict-limited pass.

S1 queue before considering other awards:

1. F1, seniority 1, preference rank 2
2. F2, seniority 2, preference rank 1
3. F3, seniority 3, preference rank 1
4. F4, seniority 4, preference rank 2

S1 queue after F1 receives S2:

1. F2, seniority 2, preference rank 1, next eligible candidate
2. F3, seniority 3, preference rank 1
3. F4, seniority 4, preference rank 2

F1's original S1 preference remains historically intact. The explanation for F1 on S1 is not "deleted" or "uninterested"; it is "candidate awarded elsewhere."

### Example: Contractual Exception

S4 is a dual-enrollment section. F1 selected S4 and is highest-seniority available. F4 also selected S4 and is assigned to teach at the partner high-school site.

Ordinary queue:

1. F1, seniority 1
2. F2, seniority 2
3. F4, seniority 4

Chair assignment:

- Award S4 to F4.
- Exception code: `dual_enrollment_positioned`.
- Written justification: "Instructor is assigned to the partner high school site."

This is a supported exception only because it has both a configured reason code and written justification. F1's S4 preference remains intact, with the outcome explained as "bypassed by documented contractual exception."

## Current Implementation Mismatches

- `scope_preferences` is a current-state table. `POST /api/preferences` deletes a faculty member's previous rows for the term before inserting the new list.
- `DELETE /api/preferences` and `POST /api/preferences/wipe` physically delete preferences for a division.
- `POST /api/upload/schedule` with `forceReplace` deletes preferences and assignments tied to replaced sections.
- Chair workflow candidate rows are generated from all active qualified PT faculty joined to eligible sections, not only faculty who selected the section.
- Assignment creation deletes any existing assignment for a section before inserting the new tentative assignment.
- Assignment delete physically deletes the assignment row.
- Assignment and reassignment routes accept a free-text `reason`, but do not persist a structured exception reason code.
- Assignment routes do not server-validate that a bypass has a recognized contractual exception code and written justification.
- Preference-window close enforcement is not evident in the backend preference save route.
- Audit logs record some events, but do not yet fully reconstruct why each candidate did or did not receive each selected section.

## Unresolved Policy Questions

1. Is the seniority order strictly per discipline, or can qualified cross-discipline pools have separate seniority lists?
2. Does "awarded elsewhere" mean one section maximum, or only unavailable when there is a meeting-pattern conflict, load cap, or other contractual limit?
3. Should preference rank influence which section a senior faculty member is considered for first?
4. Are blank, `STAFF`, and `TBA` the full set of unassigned instructor values, or should admins configure additional values per term?
5. Should faculty be allowed to revise preferences while the window is open, and if so should every revision be snapshotted?
6. What is the official lock event: window close time, chair review start, manual admin lock, or all of these?
7. What are the complete contractual exception codes and who may configure them?
8. Can a dean approve an exception without additional review, or should exceptions have a separate approval status?
9. What should happen when seniority is missing or tied?
10. Should chairs be able to assign a faculty member who did not submit a preference for a section?

## Recommended Implementation Direction

Keep the current routes operational, but introduce immutable allocation records before changing production behavior:

1. Add `scope_preference_submissions` and `scope_preference_submission_items`.
2. Add structured `reason_code` and `justification` columns to `scope_assignments`, or create an `scope_assignment_events` table.
3. Use the pure allocation analyzer to power chair queue recommendations.
4. Make chair assignment routes validate bypass rules server-side.
5. Replace destructive deletes with status transitions or superseding records after migration.

## Data Retention Note

Preference submissions, recommendation snapshots, chair decisions, exception justifications, dean review outcomes, and server-generated audit records are institutional decision records. The system should retain enough immutable data to reconstruct staffing decisions after roster, seniority, qualification, mapping, or schedule changes. The official retention duration should be set by College policy and applicable records-retention requirements; this model intentionally does not prescribe a retention period.

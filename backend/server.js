import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import Papa from "papaparse";
import { pool, query } from "./db.js";

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN?.split(",") || "*",
    credentials: true,
  })
);

app.use(express.json());

const hiddenColumns = new Set([
  "SCHEDULE_TYPE",
  "ACCOUNTING_METHOD",
  "PTRM",
  "ACTUAL_ENROLL",
  "WAIT_CAPACITY",
  "WAIT_LIST",
  "STATUS",
  "SECTION_NUMB",
]);

function normalize(value) {
  return String(value ?? "").trim();
}

function toFriendlyModality(value) {
  const v = normalize(value).toUpperCase();
  if (["ONS", "ONN", "ONC", "ONLINE", "DE", "IP"].includes(v)) return "Online";
  return v || "TBA";
}

function inferDiscipline(subjectCourse, coverageRows) {
  const subject = normalize(subjectCourse).split(" ")[0]?.toUpperCase() || "";
  const match = coverageRows.find((row) => row.subject_code.toUpperCase() === subject);
  return {
    disciplineCode: match?.discipline_code || null,
    subjectCode: subject,
  };
}

async function getCoverage(termCode) {
  const result = await query(
    `SELECT term_code, discipline_code, subject_code
     FROM discipline_subject_coverage
     WHERE term_code = $1`,
    [termCode]
  );
  return result.rows;
}

function parseScheduleRows(rows, coverageRows) {
  const crnRows = new Map();

  rows.forEach((row) => {
    const crn = normalize(row.CRN);
    if (!crn) return;
    if (!crnRows.has(crn)) crnRows.set(crn, []);
    crnRows.get(crn).push(row);
  });

  const graph = new Map();

  const ensureNode = (crn) => {
    if (!graph.has(crn)) graph.set(crn, new Set());
    graph.get(crn).add(crn);
  };

  Array.from(crnRows.keys()).forEach(ensureNode);

  rows.forEach((row) => {
    const crn = normalize(row.CRN);
    if (!crn) return;

    const cross = normalize(row.CROSS_LIST);
    const coreq = normalize(row.COREQUISITE_CRN);

    ensureNode(crn);

    if (cross) {
      ensureNode(cross);
      graph.get(crn).add(cross);
      graph.get(cross).add(crn);
    }

    if (coreq) {
      ensureNode(coreq);
      graph.get(crn).add(coreq);
      graph.get(coreq).add(crn);
    }
  });

  const visited = new Set();
  const clusters = [];

  for (const crn of graph.keys()) {
    if (visited.has(crn)) continue;

    const stack = [crn];
    const cluster = new Set();

    while (stack.length) {
      const current = stack.pop();
      if (visited.has(current)) continue;

      visited.add(current);
      cluster.add(current);

      Array.from(graph.get(current) || []).forEach((neighbor) => {
        if (!visited.has(neighbor)) stack.push(neighbor);
      });
    }

    clusters.push(Array.from(cluster).sort());
  }

  const errors = [];
  const unmapped = [];
  let crossListedGroupCount = 0;
  let corequisiteGroupCount = 0;
  let multiRowCrnGroups = 0;

  const parsedSections = clusters.map((cluster) => {
    cluster.forEach((crn) => {
      if (!crnRows.has(crn)) {
        errors.push(`CRN ${crn} is referenced by CROSS_LIST or COREQUISITE_CRN but is missing from the upload.`);
      }
    });

    const bundleRows = cluster.flatMap((crn) => crnRows.get(crn) || []);
    const instructorValues = Array.from(
      new Set(bundleRows.map((r) => normalize(r.INSTRUCTOR)).filter(Boolean))
    );

    const allStaff = instructorValues.every((value) => value.toLowerCase() === "staff");
    if (!allStaff) {
      errors.push(
        `Bundle ${cluster.join(", ")} has mixed INSTRUCTOR values: ${instructorValues.join(", ") || "(blank)"}. Fix and reupload.`
      );
    }

    const hasCross = bundleRows.some((r) => normalize(r.CROSS_LIST));
    const hasCoreq = bundleRows.some((r) => normalize(r.COREQUISITE_CRN));
    if (hasCross) crossListedGroupCount += 1;
    if (hasCoreq) corequisiteGroupCount += 1;

    if (
      Array.from(new Set(bundleRows.map((r) => normalize(r.CRN)))).some(
        (crn) => (crnRows.get(crn) || []).length > 1
      )
    ) {
      multiRowCrnGroups += 1;
    }

    const first = bundleRows[0] || {};

    const meetings = [];
    const meetingSeen = new Set();

    bundleRows.forEach((row) => {
      const key = [
        normalize(row.DAYS),
        normalize(row.START_TIME),
        normalize(row.END_TIME),
        normalize(row.BUILDING),
        normalize(row.ROOM),
      ].join("|");

      if (meetingSeen.has(key)) return;
      meetingSeen.add(key);

      meetings.push({
        days: normalize(row.DAYS),
        start_time: normalize(row.START_TIME),
        end_time: normalize(row.END_TIME),
        building: normalize(row.BUILDING),
        room: normalize(row.ROOM),
      });
    });

    const allSubjectCourses = Array.from(
      new Set(bundleRows.map((r) => normalize(r.SUBJECT_COURSE)).filter(Boolean))
    );

    const allTitles = Array.from(
      new Set(bundleRows.map((r) => normalize(r.TITLE)).filter(Boolean))
    );

    const allUnits = Array.from(
      new Set(bundleRows.map((r) => Number(normalize(r.UNITS || r.HOURS || 0)) || 0))
    ).filter(Boolean);

    const crossListGroup = Array.from(
      new Set(bundleRows.map((r) => normalize(r.CROSS_LIST)).filter(Boolean))
    );

    const coreqGroup = Array.from(
      new Set(bundleRows.map((r) => normalize(r.COREQUISITE_CRN)).filter(Boolean))
    );

    const { disciplineCode, subjectCode } = inferDiscipline(first.SUBJECT_COURSE, coverageRows);

    if (!disciplineCode) {
      unmapped.push(`${cluster.join(", ")} (${subjectCode || normalize(first.SUBJECT_COURSE) || "UNKNOWN SUBJECT"})`);
    }

    return {
      assignment_group_id: `grp_${cluster.join("_")}`,
      discipline_code: disciplineCode,
      primary_subject_course: allSubjectCourses.join(" / ") || "Unknown",
      primary_crn: cluster[0],
      all_crns: cluster,
      title: allTitles.join(" / ") || normalize(first.TITLE) || "Untitled",
      division: normalize(first.DIVISION),
      modality: toFriendlyModality(first.INSTRUCTIONAL_METHOD),
      campus: normalize(first.CAMPUS),
      units: allUnits,
      meetings,
      pt_eligible: true,
      is_grouped: cluster.length > 1 || bundleRows.length > 1,
      cross_list_group: crossListGroup.length ? cluster.filter((c) => crossListGroup.includes(c)) : null,
      corequisite_group: coreqGroup.length ? coreqGroup : null,
    };
  });

  if (unmapped.length) {
    errors.push(
      `${unmapped.length} assignment group(s) could not be mapped to a discipline: ${unmapped.slice(0, 10).join("; ")}${unmapped.length > 10 ? " ..." : ""}`
    );
  }

  return {
    errors,
    sections: parsedSections.filter((s) => s.discipline_code),
    summary: {
      totalRows: rows.length,
      totalCrns: crnRows.size,
      assignmentGroups: parsedSections.filter((s) => s.discipline_code).length,
      crossListedGroups: crossListedGroupCount,
      corequisiteGroups: corequisiteGroupCount,
      multiRowCrnGroups,
    },
  };
}

app.get("/api/health", async (_req, res) => {
  try {
    await query("SELECT NOW()");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/upload/schedule", upload.single("file"), async (req, res) => {
  try {
    const { termCode } = req.body;
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }
    if (!termCode) {
      return res.status(400).json({ error: "termCode is required." });
    }

    const csvText = req.file.buffer.toString("utf-8");
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

    const rows = parsed.data.map((row) => {
      const cleaned = {};
      Object.entries(row).forEach(([key, value]) => {
        if (!hiddenColumns.has(key)) cleaned[key] = value;
      });
      return { ...row, __clean: cleaned };
    });

    const coverageRows = await getCoverage(termCode);
    const result = parseScheduleRows(rows, coverageRows);

    if (result.errors.length) {
      return res.status(400).json({
        ok: false,
        errors: result.errors,
        summary: result.summary,
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const disciplineCodes = Array.from(
        new Set(result.sections.map((s) => s.discipline_code).filter(Boolean))
      );

      if (disciplineCodes.length) {
        await client.query(
          `DELETE FROM assignment_group_meetings
           WHERE assignment_group_id IN (
             SELECT assignment_group_id FROM assignment_groups
             WHERE term_code = $1
             AND discipline_code = ANY($2::text[])
           )`,
          [termCode, disciplineCodes]
        );

        await client.query(
          `DELETE FROM assignment_groups
           WHERE term_code = $1
           AND discipline_code = ANY($2::text[])`,
          [termCode, disciplineCodes]
        );
      }

      for (const section of result.sections) {
        await client.query(
          `INSERT INTO assignment_groups (
            term_code,
            discipline_code,
            assignment_group_id,
            primary_subject_course,
            primary_crn,
            all_crns,
            title,
            division,
            modality,
            campus,
            units,
            pt_eligible,
            is_grouped
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            termCode,
            section.discipline_code,
            section.assignment_group_id,
            section.primary_subject_course,
            section.primary_crn,
            JSON.stringify(section.all_crns),
            section.title,
            section.division,
            section.modality,
            section.campus,
            JSON.stringify(section.units),
            section.pt_eligible,
            section.is_grouped,
          ]
        );

        for (const meeting of section.meetings) {
          await client.query(
            `INSERT INTO assignment_group_meetings (
              assignment_group_id,
              days,
              start_time,
              end_time,
              building,
              room
            ) VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              section.assignment_group_id,
              meeting.days,
              meeting.start_time,
              meeting.end_time,
              meeting.building,
              meeting.room,
            ]
          );
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    res.json({
      ok: true,
      importedCount: result.sections.length,
      summary: result.summary,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/upload/seniority", async (req, res) => {
  try {
    const { termCode, rows } = req.body;

    if (!termCode || !Array.isArray(rows)) {
      return res.status(400).json({ error: "termCode and rows are required." });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const disciplineCodes = Array.from(new Set(rows.map((r) => r.discipline_code)));

      if (disciplineCodes.length) {
        await client.query(
          `DELETE FROM discipline_seniority
           WHERE term_code = $1
           AND discipline_code = ANY($2::text[])`,
          [termCode, disciplineCodes]
        );

        await client.query(
          `DELETE FROM discipline_subject_coverage
           WHERE term_code = $1
           AND discipline_code = ANY($2::text[])`,
          [termCode, disciplineCodes]
        );
      }

      for (const row of rows) {
        await client.query(
          `INSERT INTO faculty (employee_id, first_name, last_name, email)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (employee_id)
           DO UPDATE SET first_name = EXCLUDED.first_name,
                         last_name = EXCLUDED.last_name,
                         email = EXCLUDED.email`,
          [row.employee_id, row.first_name, row.last_name, row.email]
        );

        await client.query(
          `INSERT INTO discipline_seniority (
            term_code,
            discipline_code,
            employee_id,
            seniority_date,
            seniority_rank,
            active_flag,
            covered_subject_codes,
            notes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            termCode,
            row.discipline_code,
            row.employee_id,
            row.seniority_date,
            row.seniority_rank,
            row.active_flag ?? true,
            row.covered_subject_codes,
            row.notes || "",
          ]
        );

        const covered = String(row.covered_subject_codes || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);

        for (const subjectCode of covered) {
          await client.query(
            `INSERT INTO discipline_subject_coverage (term_code, discipline_code, subject_code)
             VALUES ($1,$2,$3)`,
            [termCode, row.discipline_code, subjectCode]
          );
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    res.json({ ok: true, importedRows: rows.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/sections/:termCode/:disciplineCode", async (req, res) => {
  try {
    const { termCode, disciplineCode } = req.params;

    const groups = await query(
      `SELECT * FROM assignment_groups
       WHERE term_code = $1 AND discipline_code = $2
       ORDER BY primary_subject_course, primary_crn`,
      [termCode, disciplineCode]
    );

    const meetings = await query(
      `SELECT * FROM assignment_group_meetings
       WHERE assignment_group_id IN (
         SELECT assignment_group_id FROM assignment_groups
         WHERE term_code = $1 AND discipline_code = $2
       )`,
      [termCode, disciplineCode]
    );

    const meetingMap = new Map();
    meetings.rows.forEach((m) => {
      if (!meetingMap.has(m.assignment_group_id)) meetingMap.set(m.assignment_group_id, []);
      meetingMap.get(m.assignment_group_id).push(m);
    });

    const data = groups.rows.map((group) => ({
      ...group,
      all_crns: JSON.parse(group.all_crns || "[]"),
      units: JSON.parse(group.units || "[]"),
      meetings: meetingMap.get(group.assignment_group_id) || [],
    }));

    res.json({ ok: true, sections: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/disciplines/open", async (req, res) => {
  try {
    const { termCode, disciplineCode, opensAt, closesAt } = req.body;

    await query(
      `INSERT INTO discipline_windows (term_code, discipline_code, opens_at, closes_at, status)
       VALUES ($1,$2,$3,$4,'open')
       ON CONFLICT DO NOTHING`,
      [termCode, disciplineCode, opensAt, closesAt]
    );

    await query(
      `UPDATE discipline_windows
       SET opens_at = $3, closes_at = $4, status = 'open'
       WHERE term_code = $1 AND discipline_code = $2`,
      [termCode, disciplineCode, opensAt, closesAt]
    );

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/faculty/submission", async (req, res) => {
  try {
    const { termCode, disciplineCode, employeeId, selections, generalInterests } = req.body;

    const submissionResult = await query(
      `INSERT INTO faculty_submissions (
        term_code,
        discipline_code,
        employee_id,
        submitted,
        submitted_at,
        general_interests
      ) VALUES ($1,$2,$3,TRUE,NOW(),$4)
      RETURNING id`,
      [termCode, disciplineCode, employeeId, JSON.stringify(generalInterests || [])]
    );

    const submissionId = submissionResult.rows[0].id;

    for (let i = 0; i < selections.length; i += 1) {
      await query(
        `INSERT INTO faculty_ranked_preferences (
          submission_id,
          assignment_group_id,
          preference_rank
        ) VALUES ($1,$2,$3)`,
        [submissionId, selections[i], i + 1]
      );
    }

    res.json({ ok: true, submissionId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/assignments", async (req, res) => {
  try {
    const { termCode, disciplineCode, assignmentGroupId, employeeId, actorName, reason } = req.body;

    await query(
      `INSERT INTO assignments (
        term_code,
        discipline_code,
        assignment_group_id,
        employee_id,
        status
      ) VALUES ($1,$2,$3,$4,'draft')`,
      [termCode, disciplineCode, assignmentGroupId, employeeId]
    );

    await query(
      `INSERT INTO decision_logs (
        term_code,
        discipline_code,
        actor_name,
        event_type,
        detail
      ) VALUES ($1,$2,$3,$4,$5)`,
      [
        termCode,
        disciplineCode,
        actorName || "System",
        reason ? "bypassed_preference" : "assigned",
        reason
          ? `Assigned ${assignmentGroupId} to ${employeeId} with rationale: ${reason}`
          : `Assigned ${assignmentGroupId} to ${employeeId}`,
      ]
    );

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/disciplines/finalize", async (req, res) => {
  try {
    const { termCode, disciplineCode } = req.body;

    await query(
      `UPDATE discipline_windows
       SET status = 'chair_finalized'
       WHERE term_code = $1 AND discipline_code = $2`,
      [termCode, disciplineCode]
    );

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/disciplines/dean-approve", async (req, res) => {
  try {
    const { termCode, disciplineCode } = req.body;

    await query(
      `UPDATE discipline_windows
       SET status = 'dean_approved'
       WHERE term_code = $1 AND discipline_code = $2`,
      [termCode, disciplineCode]
    );

    await query(
      `UPDATE assignments
       SET status = 'approved'
       WHERE term_code = $1 AND discipline_code = $2 AND status <> 'released'`,
      [termCode, disciplineCode]
    );

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});

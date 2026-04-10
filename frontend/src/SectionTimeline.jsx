
import React, { useState } from "react";
import { buildDecisionTimeline } from "./buildDecisionTimeline";

export default function SectionTimeline({
  section,
  candidates,
  assignments,
  hasTimeConflict,
  getConflictDetails
}) {
  const [expanded, setExpanded] = useState(null);

  const timeline = buildDecisionTimeline(
    section,
    candidates,
    assignments,
    hasTimeConflict
  );

  const top = timeline.find(t => t.status === "top_candidate");

  return (
    <div className="timeline">

      {top && (
        <div className="decision-summary">
          🧠 {top.instructor} selected due to {top.reason.join(", ")}
        </div>
      )}

      {timeline.map((item, i) => {
        const conflict = item.status === "conflict"
          ? getConflictDetails?.(item.instructor, section)
          : null;

        return (
          <div key={i} className={`timeline-row ${item.status}`}>

            <div
              className="timeline-label"
              onClick={() => setExpanded(expanded === i ? null : i)}
              style={{ cursor: conflict ? "pointer" : "default" }}
            >
              {item.status === "top_candidate" && "Top Candidate"}
              {(item.status === "conflict" || item.status === "assigned_elsewhere") && "Bypassed"}
            </div>

            <div className="timeline-name">
              {item.instructor}
            </div>

            <div className="timeline-reason">
              {item.reason.join(", ")}
            </div>

            {expanded === i && conflict && (
              <div className="conflict-details">
                ⚠ Conflicts with:
                <div><strong>{conflict.course}</strong></div>
                <div>{conflict.days} {conflict.time}</div>
              </div>
            )}

          </div>
        );
      })}
    </div>
  );
}

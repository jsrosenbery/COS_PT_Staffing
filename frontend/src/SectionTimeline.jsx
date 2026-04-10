
import React from "react";
import { buildDecisionTimeline } from "./buildDecisionTimeline";

export default function SectionTimeline({ section, candidates, assignments, hasTimeConflict }) {
  const timeline = buildDecisionTimeline(section, candidates, assignments, hasTimeConflict);
  const top = timeline.find(t => t.status === "top_candidate");

  return (
    <div className="timeline">
      {top && (
        <div className="decision-summary">
          🧠 {top.instructor} selected due to {top.reason.join(", ")}
        </div>
      )}

      {timeline.map((item, i) => (
        <div key={i} className={`timeline-row ${item.status}`}>
          <div className="timeline-label">
            {item.status === "top_candidate" && "Top Candidate"}
            {(item.status === "conflict" || item.status === "assigned_elsewhere") && "Bypassed"}
          </div>

          <div className="timeline-name">{item.instructor}</div>

          <div className="timeline-reason">{item.reason.join(", ")}</div>
        </div>
      ))}
    </div>
  );
}

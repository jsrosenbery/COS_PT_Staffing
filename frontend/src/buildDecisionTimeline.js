
export const buildDecisionTimeline = (section, candidates = [], assignments = {}, hasTimeConflict) => {
  return candidates.map((c, index) => {
    let status = "eligible"
    let reason = []

    if (assignments[c.id]) {
      status = "assigned_elsewhere"
      reason.push("Already assigned")
    }

    if (hasTimeConflict && hasTimeConflict(c, section)) {
      status = "conflict"
      reason.push("Time conflict")
    }

    if (index === 0 && status === "eligible") {
      status = "top_candidate"
      reason.push("Highest priority candidate")
    }

    return {
      instructor: c.name,
      status,
      reason
    }
  }).filter(t => t.status !== "eligible")
}

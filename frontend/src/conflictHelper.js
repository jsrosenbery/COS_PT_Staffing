
export const getConflictDetails = (instructorName, section, allAssignments, overlaps) => {
  const conflict = allAssignments.find(a =>
    a.instructor === instructorName &&
    overlaps(a, section)
  );

  if (!conflict) return null;

  return {
    course: `${conflict.subject} ${conflict.number}`,
    days: conflict.days,
    time: `${conflict.start} - ${conflict.end}`
  };
};

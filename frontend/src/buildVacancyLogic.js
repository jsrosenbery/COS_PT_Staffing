export const markVacant = (section) => {
  return { ...section, status: "vacant" };
};

export const getRecoveryCandidates = (section, candidates, hasTimeConflict) => {
  return candidates.filter(c => !hasTimeConflict(c, section));
};

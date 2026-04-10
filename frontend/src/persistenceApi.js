
const API = "http://localhost:3001";

export const saveRoles = async (roles) => {
  await fetch(`${API}/roles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(roles)
  });
};

export const savePTFaculty = async (data) => {
  await fetch(`${API}/pt-faculty`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
};

export const loadPTFaculty = async () => {
  const res = await fetch(`${API}/pt-faculty`);
  return res.json();
};

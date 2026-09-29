import PTFacultyStaffingMVP from "./pt-faculty-staffing-mvp.jsx";
import { useState } from "react";

export default function App() {
  const [generation, setGeneration] = useState(0);
  const [notice, setNotice] = useState("");
  return <PTFacultyStaffingMVP key={generation} signOutNotice={notice}
    onSignedOut={() => { setNotice("Signed out on this device."); setGeneration(value => value + 1); }}
    onSignOutResult={setNotice} />;
}

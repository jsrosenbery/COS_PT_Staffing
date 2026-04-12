import express from "express";
const router = express.Router();

let roles = [];
let ptFaculty = [];

router.get("/roles", async (_req, res) => {
  res.json(roles);
});

router.post("/roles", async (req, res) => {
  roles = req.body || [];
  res.json({ ok: true });
});

router.get("/pt-faculty", async (_req, res) => {
  res.json(ptFaculty);
});

router.post("/pt-faculty", async (req, res) => {
  ptFaculty = req.body || [];
  res.json({ ok: true });
});

router.delete("/pt-faculty", async (_req, res) => {
  ptFaculty = [];
  res.json({ ok: true });
});

export default router;

import express from "express";
const router = express.Router();

router.get("/terms", (_req, res) => {
  res.json({ terms: [] });
});

export default router;

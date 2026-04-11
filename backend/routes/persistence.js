import express from "express";
const router = express.Router();

router.get("/roles", async (_req, res) => {
  res.json([]);
});

export default router;


const express = require('express');
const router = express.Router();

let memoryStore = {
  roles: [],
  ptFaculty: [],
  windows: [],
  audit: []
};

router.post('/roles', (req, res) => {
  memoryStore.roles = req.body;
  res.json({ success: true });
});

router.post('/pt-faculty', (req, res) => {
  memoryStore.ptFaculty = req.body;
  res.json({ success: true });
});

router.get('/pt-faculty', (req, res) => {
  res.json(memoryStore.ptFaculty);
});

router.post('/windows', (req, res) => {
  memoryStore.windows.push(req.body);
  res.json({ success: true });
});

router.get('/audit', (req, res) => {
  res.json(memoryStore.audit);
});

module.exports = router;

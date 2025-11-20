const db = require('../config/db');

const Participants = {
  // Create minimal participant with uid and type; qr_code is usually same as uid
  create: async ({ uid, type, qr_code }) => {
    const sql = `INSERT INTO participants (uid, type, qr_code) VALUES (?, ?, ?)`;
    const [res] = await db.execute(sql, [uid, type, qr_code]);
    return { id: res.insertId };
  },
  ensureActivitiesRow: async (participant_id) => {
    const [rows] = await db.execute(`SELECT id FROM activities WHERE participant_id = ?`, [participant_id]);
    if (rows.length === 0) {
      await db.execute(`INSERT INTO activities (participant_id, welcome_kit, breakfast, lunch, high_tea, timestamps) VALUES (?, 0, 0, 0, 0, JSON_OBJECT())`, [participant_id]);
    }
  },
  // List participants; search by uid or type text
  list: async ({ limit = 10, page = 1, search = '' }) => {
    const offset = (page - 1) * limit;
    let where = '';
    let params = [];
    if (search) {
      where = `WHERE uid LIKE ? OR CAST(type AS CHAR) LIKE ?`;
      params = [`%${search}%`, `%${search}%`];
    }
    const [rows] = await db.execute(
      `SELECT id, uid, type, qr_code, created_at FROM participants ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)]
    );
    const [countRows] = await db.execute(
      `SELECT COUNT(*) AS total FROM participants ${where}`,
      params
    );
    return { data: rows, total: countRows[0].total };
  },
  getById: async (id) => {
    const [rows] = await db.execute(`SELECT * FROM participants WHERE id = ?`, [id]);
    return rows[0] || null;
  },
  getByQRCode: async (qr_code) => {
    const [rows] = await db.execute(`SELECT * FROM participants WHERE qr_code = ?`, [qr_code]);
    return rows[0] || null;
  },
  // Lookup by UID (primary identifier used in QR and UI)
  getByUID: async (uid) => {
    const [rows] = await db.execute(`SELECT * FROM participants WHERE uid = ?`, [uid]);
    return rows[0] || null;
  },
  // Legacy: phone-based lookup (kept for any remaining public APIs)
  getByPhone: async (phone) => {
    const [rows] = await db.execute(`SELECT * FROM participants WHERE phone = ?`, [phone]);
    return rows[0] || null;
  },
  // Update minimal fields: uid and type
  update: async (id, { uid, type }) => {
    const sql = `UPDATE participants SET uid = ?, type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    await db.execute(sql, [uid, type, id]);
  },
  deleteById: async (id) => {
    await db.execute(`DELETE FROM participants WHERE id = ?`, [id]);
  }
};

module.exports = Participants;

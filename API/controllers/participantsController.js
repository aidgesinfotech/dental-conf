const Participants = require('../models/participantsModel');
const { Activities } = require('../models/activitiesModel');

exports.createParticipant = async (req, res) => {
  try {
    const { uid, type } = req.body || {};
    if (!uid || typeof type === 'undefined') {
      return res.status(400).json({ error: 'uid and type are required' });
    }
    const numType = Number(type);
    if (![1, 2, 3, 4, 5, 6].includes(numType)) {
      return res.status(400).json({ error: 'Invalid type. Use 1=Faculty, 2=Committee, 3=AWARDEES, 4=IDA, 5=NON IDA, 6=RC' });
    }
    const qr_code = String(uid); // QR stores UID directly
    const { id } = await Participants.create({ uid: String(uid), type: numType, qr_code });
    await Participants.ensureActivitiesRow(id);
    const row = await Participants.getById(id);
    const data = row ? { id: row.id, uid: row.uid, type: row.type, qr_code: row.qr_code } : null;
    res.status(201).json({ status: 'success', data });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      try {
        // Idempotent behaviour for same UID + type: if a participant with the same
        // UID already exists and has the same type, treat this as success instead
        // of an error. This allows safe re-import of the same CSV.
        const existing = await Participants.getByUID(String(req.body?.uid || ''));
        if (existing) {
          const existingType = Number(existing.type);
          const requestedType = Number(req.body?.type);
          if (existingType === requestedType) {
            const data = { id: existing.id, uid: existing.uid, type: existing.type, qr_code: existing.qr_code };
            return res.status(200).json({ status: 'success', data, note: 'Already existed' });
          }
        }
        return res.status(409).json({ error: 'UID already exists' });
      } catch (lookupErr) {
        console.error('createParticipant ER_DUP_ENTRY lookup error:', lookupErr);
        return res.status(409).json({ error: 'UID already exists' });
      }
    }
    console.error('createParticipant error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.listParticipants = async (req, res) => {
  try {
    const { limit = 10, page = 1, search = '' } = req.query;
    const result = await Participants.list({ limit: Number(limit), page: Number(page), search: String(search) });
    // expose only minimal safe fields
    const safe = (result.data || []).map((r) => ({ id: r.id, uid: r.uid, type: r.type, qr_code: r.qr_code }));
    res.status(200).json({ status: 'success', data: safe, total: result.total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error('listParticipants error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getParticipant = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await Participants.getById(id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const data = { id: row.id, uid: row.uid, type: row.type, qr_code: row.qr_code };
    res.status(200).json({ status: 'success', data });
  } catch (err) {
    console.error('getParticipant error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateParticipant = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await Participants.getById(id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const uid = typeof req.body?.uid !== 'undefined' ? String(req.body.uid) : existing.uid;
    const typeRaw = typeof req.body?.type !== 'undefined' ? Number(req.body.type) : existing.type;
    if (![1, 2, 3, 4, 5, 6].includes(typeRaw)) {
      return res.status(400).json({ error: 'Invalid type. Use 1=Faculty, 2=Committee, 3=AWARDEES, 4=IDA, 5=NON IDA, 6=RC' });
    }

    await Participants.update(id, { uid, type: typeRaw });
    const row = await Participants.getById(id);
    const data = { id: row.id, uid: row.uid, type: row.type, qr_code: row.qr_code };
    res.status(200).json({ status: 'success', data });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'UID already exists' });
    }
    console.error('updateParticipant error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.deleteParticipant = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await Participants.getById(id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    await Participants.deleteById(id);
    res.status(200).json({ status: 'success' });
  } catch (err) {
    console.error('deleteParticipant error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Public: lookup participant by uid or phone (no auth)
exports.publicLookupByPhone = async (req, res) => {
  try {
    const uid = req.query.uid ? String(req.query.uid).trim() : '';
    const phoneRaw = String(req.query.phone || '').replace(/\D/g, '');
    if (!uid && (!phoneRaw || phoneRaw.length < 7)) {
      return res.status(400).json({ error: 'uid or phone is required' });
    }

    let row = null;
    if (uid) {
      row = await Participants.getByUID(uid);
    }
    if (!row && phoneRaw && phoneRaw.length >= 7) {
      row = await Participants.getByPhone(phoneRaw);
    }
    if (!row) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json({ status: 'success', data: row });
  } catch (err) {
    console.error('publicLookupByPhone error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Public: summary counts (pending, completed, events) for a participant by uid or phone
exports.publicSummaryByPhone = async (req, res) => {
  try {
    const uid = req.query.uid ? String(req.query.uid).trim() : '';
    const phoneRaw = String(req.query.phone || '').replace(/\D/g, '');
    if (!uid && (!phoneRaw || phoneRaw.length < 7)) return res.status(400).json({ error: 'uid or phone is required' });
    const db = require('../config/db');
    let p = null;
    if (uid) {
      p = await Participants.getByUID(uid);
    }
    if (!p && phoneRaw && phoneRaw.length >= 7) {
      p = await Participants.getByPhone(phoneRaw);
    }
    if (!p) return res.status(404).json({ error: 'Not found' });

    const participant_id = p.id;
    const event_id = req.query.event_id ? Number(req.query.event_id) : null;

    const whereSummary = ['participant_id = ?'];
    const paramsSummary = [participant_id];
    if (event_id) { whereSummary.push('event_id = ?'); paramsSummary.push(event_id); }

    const [rows] = await db.execute(
      `SELECT status, COUNT(*) AS cnt FROM event_item_allocations WHERE ${whereSummary.join(' AND ')} GROUP BY status`,
      paramsSummary
    );
    const [evRows] = await db.execute(
      `SELECT DISTINCT event_id FROM event_item_allocations WHERE participant_id = ? ORDER BY event_id DESC`,
      [participant_id]
    );
    const pending = Number(rows.find(r => r.status === 'pending')?.cnt || 0);
    const completed = Number(rows.find(r => r.status === 'completed')?.cnt || 0);
    const events = evRows.map(r => ({ event_id: r.event_id }));
    res.status(200).json({ status: 'success', data: { pending, completed, events } });
  } catch (err) {
    console.error('publicSummaryByPhone error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Public: history list for a participant by uid or phone
exports.publicHistoryByPhone = async (req, res) => {
  try {
    const uid = req.query.uid ? String(req.query.uid).trim() : '';
    const phoneRaw = String(req.query.phone || '').replace(/\D/g, '');
    if (!uid && (!phoneRaw || phoneRaw.length < 7)) return res.status(400).json({ error: 'uid or phone is required' });
    const db = require('../config/db');
    let p = null;
    if (uid) {
      p = await Participants.getByUID(uid);
    }
    if (!p && phoneRaw && phoneRaw.length >= 7) {
      p = await Participants.getByPhone(phoneRaw);
    }
    if (!p) return res.status(404).json({ error: 'Not found' });

    const participant_id = p.id;
    const status = req.query.status && ['pending','completed'].includes(String(req.query.status)) ? String(req.query.status) : null;
    const event_id = req.query.event_id ? Number(req.query.event_id) : null;
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const page = Math.max(Number(req.query.page || 1), 1);
    const offset = (page - 1) * limit;

    const where = ['a.participant_id = ?'];
    const params = [participant_id];
    if (status) { where.push('a.status = ?'); params.push(status); }
    if (event_id) { where.push('a.event_id = ?'); params.push(event_id); }

    const [rows] = await db.execute(
      `SELECT a.event_id, a.item_id, a.status, a.created_at, a.updated_at, a.completed_at,
              i.name AS item_name, i.code AS item_code
       FROM event_item_allocations a
       JOIN event_items i ON i.id = a.item_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.updated_at DESC, a.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.status(200).json({ status: 'success', data: rows });
  } catch (err) {
    console.error('publicHistoryByPhone error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.exportCSV = async (req, res) => {
  try {
    const db = require('../config/db');
    const [rows] = await db.execute(`
      SELECT uid, type
      FROM participants
      ORDER BY created_at DESC`);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="participants.csv"');

    const headers = ['UID','Type'];
    res.write(headers.join(',') + '\n');

    const typeLabel = (t) => {
      const n = Number(t);
      if (n === 1) return 'Faculty';
      if (n === 2) return 'Committee';
      if (n === 3) return 'AWARDEES';
      if (n === 4) return 'IDA';
      if (n === 5) return 'NON IDA';
      if (n === 6) return 'RC';
      return String(t || '');
    };

    for (const r of rows) {
      const line = [
        (r.uid||'').replace(/,/g,' '),
        typeLabel(r.type)
      ].join(',');
      res.write(line + '\n');
    }
    res.end();
  } catch (err) {
    console.error('exportCSV error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

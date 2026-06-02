'use strict';

const store = {
  clients: [],
  visits: [],
  feedback_requests: [],
  feedback_responses: [],
  follow_ups: [],
  _seq: {},
};

function nextId(table) {
  store._seq[table] = (store._seq[table] || 0) + 1;
  return store._seq[table];
}

async function query(text, params = []) {
  // Parse the SQL to figure out what to do — implement the key queries used by the app
  const sql = text.trim().toLowerCase();

  // INSERT INTO clients ... RETURNING *
  if (sql.startsWith('insert into clients')) {
    const row = {
      id: nextId('clients'),
      name: params[0], phone: params[1], email: params[2],
      preferred_contact: params[3] || 'sms',
      opt_out: false,
      created_at: new Date().toISOString(),
      visit_count: 0,
    };
    store.clients.push(row);
    return [row];
  }

  // INSERT INTO visits ... RETURNING id
  if (sql.startsWith('insert into visits')) {
    const row = {
      id: nextId('visits'),
      client_id: params[0], visit_date: params[1],
      caregiver_name: params[2], status: params[3] || 'completed',
      created_at: new Date().toISOString(),
    };
    store.visits.push(row);
    return [row];
  }

  // INSERT INTO feedback_requests
  if (sql.startsWith('insert into feedback_requests')) {
    const row = {
      id: nextId('feedback_requests'),
      visit_id: params[0], client_id: params[1], token: params[2],
      scheduled_for: params[3] || new Date().toISOString(),
      status: 'pending', sent_at: null, channel: null,
      created_at: new Date().toISOString(),
    };
    store.feedback_requests.push(row);
    return [row];
  }

  // INSERT INTO feedback_responses
  if (sql.startsWith('insert into feedback_responses')) {
    const row = {
      id: nextId('feedback_responses'),
      feedback_request_id: params[0], client_id: params[1],
      rating: params[2], comment: params[3],
      routed_to_google: params[4], internal_flagged: params[5],
      submitted_at: new Date().toISOString(),
    };
    store.feedback_responses.push(row);
    return [row];
  }

  // INSERT INTO follow_ups
  if (sql.startsWith('insert into follow_ups')) {
    const row = {
      id: nextId('follow_ups'),
      feedback_request_id: params[0], scheduled_for: params[1],
      sent_at: null, status: 'pending',
    };
    store.follow_ups.push(row);
    return [row];
  }

  // SELECT clients with visit count (GROUP BY / LEFT JOIN)
  if (sql.includes('from clients') && sql.includes('left join visits') && sql.includes('group by')) {
    return store.clients.map(c => ({
      ...c,
      visit_count: store.visits.filter(v => v.client_id === c.id).length,
    })).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  // SELECT * FROM clients WHERE id = $1
  if (sql.includes('from clients') && sql.includes('where') && !sql.includes('join')) {
    if (sql.includes('count(')) {
      return store.clients.map(c => ({
        ...c,
        visit_count: store.visits.filter(v => v.client_id === c.id).length,
      }));
    }
    const id = parseInt(params[0]);
    return store.clients.filter(c => c.id === id);
  }

  // UPDATE clients SET opt_out
  if (sql.startsWith('update clients set opt_out')) {
    const id = parseInt(params[0]);
    const c = store.clients.find(c => c.id === id);
    if (c) c.opt_out = true;
    return [];
  }

  // UPDATE clients SET name,phone,email... RETURNING *
  if (sql.startsWith('update clients set') && sql.includes('returning')) {
    const id = parseInt(params[5]);
    const c = store.clients.find(c => c.id === id);
    if (c) {
      c.name = params[0]; c.phone = params[1]; c.email = params[2];
      c.preferred_contact = params[3]; c.opt_out = params[4];
    }
    return c ? [c] : [];
  }

  // SELECT fr.* JOIN clients JOIN visits WHERE fr.token = $1
  if (sql.includes('fr.token') && sql.includes('join clients') && sql.includes('join visits')) {
    const fr = store.feedback_requests.find(r => r.token === params[0]);
    if (!fr) return [];
    const client = store.clients.find(c => c.id === fr.client_id) || {};
    const visit = store.visits.find(v => v.id === fr.visit_id) || {};
    return [{ id: fr.id, status: fr.status, client_name: client.name,
               caregiver_name: visit.caregiver_name, visit_date: visit.visit_date,
               ...fr, phone: client.phone, email: client.email,
               preferred_contact: client.preferred_contact, opt_out: client.opt_out }];
  }

  // SELECT feedback_requests JOIN clients JOIN visits WHERE fr.id = $1
  if (sql.includes('from feedback_requests fr') && sql.includes('join clients') && params.length === 1) {
    const id = parseInt(params[0]);
    const fr = store.feedback_requests.find(r => r.id === id);
    if (!fr) return [];
    const client = store.clients.find(c => c.id === fr.client_id) || {};
    const visit = store.visits.find(v => v.id === fr.visit_id) || {};
    return [{ ...fr, client_name: client.name, phone: client.phone, email: client.email,
               preferred_contact: client.preferred_contact, opt_out: client.opt_out,
               caregiver_name: visit.caregiver_name, visit_date: visit.visit_date }];
  }

  // SELECT client_id FROM feedback_requests WHERE token = $1
  if (sql.includes('from feedback_requests') && sql.includes('token') && !sql.includes('join')) {
    const fr = store.feedback_requests.find(r => r.token === params[0]);
    return fr ? [{ client_id: fr.client_id }] : [];
  }

  // SELECT id FROM feedback_requests WHERE status='pending' AND scheduled_for <= NOW()
  if (sql.includes('from feedback_requests') && sql.includes("status = 'pending'") && sql.includes('scheduled_for')) {
    return store.feedback_requests
      .filter(r => r.status === 'pending' && new Date(r.scheduled_for) <= new Date())
      .slice(0, 50).map(r => ({ id: r.id }));
  }

  // SELECT routed_to_google FROM feedback_responses WHERE feedback_request_id=$1
  if (sql.includes('routed_to_google') && sql.includes('from feedback_responses')) {
    const reqId = parseInt(params[0]);
    const resp = store.feedback_responses.filter(r => r.feedback_request_id === reqId)
      .sort((a, b) => b.id - a.id)[0];
    return resp ? [{ routed_to_google: resp.routed_to_google }] : [];
  }

  // UPDATE feedback_requests SET status
  if (sql.startsWith('update feedback_requests set status')) {
    const idOrToken = params[params.length - 1];
    store.feedback_requests.forEach(r => {
      if (r.id === parseInt(idOrToken) || r.token === idOrToken) {
        r.status = params[0];
        if (sql.includes('sent_at')) { r.sent_at = new Date().toISOString(); r.channel = params[1]; }
      }
    });
    return [];
  }

  // UPDATE feedback_requests SET status='opted_out' WHERE token=$1 AND status='pending'
  if (sql.startsWith('update feedback_requests') && sql.includes('opted_out') && sql.includes('token')) {
    store.feedback_requests.forEach(r => {
      if (r.token === params[0] && r.status === 'pending') r.status = 'opted_out';
    });
    return [];
  }

  // UPDATE follow_ups SET status='cancelled'
  if (sql.startsWith('update follow_ups set status') && sql.includes('cancelled')) {
    const reqId = parseInt(params[0]);
    store.follow_ups.forEach(f => {
      if (f.feedback_request_id === reqId && f.status === 'pending') f.status = 'cancelled';
    });
    return [];
  }

  // Dashboard stats queries
  if (sql.includes('count(*)') && sql.includes('from feedback_requests') && !sql.includes('join')) {
    return [{ count: String(store.feedback_requests.length) }];
  }
  if (sql.includes('count(*)') && sql.includes('from feedback_responses') && !sql.includes('where')) {
    return [{ count: String(store.feedback_responses.length) }];
  }
  if (sql.includes('avg(rating)') && sql.includes('from feedback_responses')) {
    const ratings = store.feedback_responses.map(r => r.rating);
    const avg = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2) : 0;
    return [{ avg: String(avg) }];
  }
  if (sql.includes('routed_to_google = true')) {
    return [{ count: String(store.feedback_responses.filter(r => r.routed_to_google).length) }];
  }
  if (sql.includes('internal_flagged = true')) {
    return [{ count: String(store.feedback_responses.filter(r => r.internal_flagged).length) }];
  }
  if (sql.includes('group by rating')) {
    const dist = {};
    store.feedback_responses.forEach(r => { dist[r.rating] = (dist[r.rating] || 0) + 1; });
    return Object.entries(dist).sort().map(([rating, count]) => ({ rating: parseInt(rating), count }));
  }
  if (sql.includes('group by date(submitted_at)')) {
    return [];
  }

  // Dashboard responses list
  if (sql.includes('from feedback_responses') && sql.includes('order by')) {
    const limit = parseInt(params[0]) || 50;
    const offset = parseInt(params[1]) || 0;
    const rows = store.feedback_responses.map(resp => {
      const fr = store.feedback_requests.find(r => r.id === resp.feedback_request_id) || {};
      const client = store.clients.find(c => c.id === resp.client_id) || {};
      const visit = store.visits.find(v => v.id === fr.visit_id) || {};
      return {
        response_id: resp.id, rating: resp.rating, comment: resp.comment,
        submitted_at: resp.submitted_at, routed_to_google: resp.routed_to_google,
        internal_flagged: resp.internal_flagged, client_name: client.name,
        caregiver_name: visit.caregiver_name, visit_date: visit.visit_date,
      };
    }).sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))
      .slice(offset, offset + limit);
    return rows;
  }

  // Fallback
  console.warn('[MockDB] Unhandled query:', text.substring(0, 80));
  return [];
}

async function queryOne(text, params) {
  const rows = await query(text, params);
  return rows[0] || null;
}

module.exports = { query, queryOne };

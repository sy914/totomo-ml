const https = require('https');

const CLIENT_ID = '6442961844491511';
const CLIENT_SECRET = 'x1bHlZ6cAbXB2TBfnLVZxBly2B0Z3FYJ';
const BASE = 'api.mercadolibre.com';

function httpsGet(path, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: BASE,
      path,
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error: ' + data.slice(0,100))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPost(path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = new URLSearchParams(body).toString();
    const opts = {
      hostname: BASE,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error')); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }

  try {
    const qs = event.queryStringParameters || {};
    const dateFrom = qs.date_from || null;
    const dateTo = qs.date_to || null;

    // 1. Token
    const tokenData = await httpsPost('/oauth/token', {
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    });
    if (!tokenData.access_token) throw new Error(tokenData.message || 'Sin token');
    const token = tokenData.access_token;

    // 2. Usuario
    const user = await httpsGet('/users/me', token);
    const sellerId = user.id;

    // 3. Publicaciones
    const search = await httpsGet(`/users/${sellerId}/items/search?limit=50`, token);
    const ids = search.results || [];

    // 4. Calcular rango de visitas en días
    let visitDays = 30;
    if (dateFrom) {
      const diffMs = Date.now() - new Date(dateFrom).getTime();
      visitDays = Math.min(Math.max(Math.ceil(diffMs / 86400000), 1), 60);
    }

    // 5. Items + visitas + preguntas + órdenes
    // Siempre traemos las últimas 50 órdenes sin filtro de fecha en la API
    // El filtrado por rango lo hace el frontend para evitar problemas de timezone
    let ordersPath = `/orders/search?seller=${sellerId}&sort=date_desc&limit=50`;

    const [itemsData, questionsData, ordersData] = await Promise.all([
      Promise.all(ids.map(id => httpsGet(`/items/${id}`, token))),
      httpsGet(`/my/questions/search?seller_id=${sellerId}&limit=25&sort_fields=date_created&sort_types=DESC`, token),
      httpsGet(ordersPath, token)
    ]);

    const visitsData = await Promise.allSettled(
      ids.map(id => httpsGet(`/items/${id}/visits?last=${visitDays}`, token))
    );
    const visitsMap = {};
    ids.forEach((id, i) => {
      visitsMap[id] = visitsData[i].status === 'fulfilled' ? visitsData[i].value : null;
    });

    const payload = {
      user,
      items: itemsData,
      visitsMap,
      visitDays,
      questions: questionsData.questions || [],
      orders: ordersData.results || [],
      dateFrom,
      dateTo
    };

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};

// Spotify Web API — Client Credentials Flow.
// Як endpoint: GET /search?q=<номи суруд> → { name, artist, albumCover }.
require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 4000;

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// Агар калидҳо гум бошанд — дарҳол хато нишон медиҳем (то дертар «сеҳру ҷоду» набошад).
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ .env-ро пур кунед: SPOTIFY_CLIENT_ID ва SPOTIFY_CLIENT_SECRET');
  process.exit(1);
}

// ─── Кэши токен ───
// Токен ~1 соат зинда аст. Онро дар хотира нигоҳ медорем ва такрор истифода мебарем,
// то ба ҳар дархост токени нав напурсем. Ҳеҷ async thunk лозим нест — танҳо як тағйирёбанда.
let tokenCache = { value: null, expiresAt: 0 };

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache.value && now < tokenCache.expiresAt) {
    return tokenCache.value; // токени кэшшуда ҳанӯз кор мекунад
  }

  // Client Credentials Flow: Basic auth = base64("clientId:clientSecret")
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await axios.post(
    'https://accounts.spotify.com/api/token',
    'grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    },
  );

  tokenCache = {
    value: res.data.access_token,
    // 60 сония пеш аз анҷом нав мекунем — то дар лаҳзаи истифода кӯҳна нашавад.
    expiresAt: now + (res.data.expires_in - 60) * 1000,
  };
  return tokenCache.value;
}

// ─── Endpoint: ҷустуҷӯи суруд ───
app.get('/search', async (req, res) => {
  const q = req.query.q;
  if (!q) {
    return res
      .status(400)
      .json({ error: 'Параметри "q" лозим аст. Мисол: /search?q=shape of you' });
  }

  try {
    const token = await getAccessToken();
    const result = await axios.get('https://api.spotify.com/v1/search', {
      headers: { Authorization: `Bearer ${token}` },
      params: { q, type: 'track', limit: 1 },
    });

    const track = result.data.tracks.items[0];
    if (!track) {
      return res.status(404).json({ error: `Суруд ёфт нашуд: "${q}"` });
    }

    // Маҳз он чизе, ки шумо хостед: номи суруд, овозхон, линки расми албом.
    res.json({
      name: track.name,
      artist: track.artists.map((a) => a.name).join(', '),
      albumCover: track.album.images[0] ? track.album.images[0].url : null,
      // бонус — метавонед истифода баред ё нодида гиред:
      previewUrl: track.preview_url,
      spotifyUrl: track.external_urls.spotify,
    });
  } catch (err) {
    console.error('Spotify API error:', err.response ? err.response.data : err.message);
    res.status(500).json({ error: 'Хатои Spotify API. Калидҳо ё интернетро тафтиш кунед.' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Spotify demo кор мекунад:`);
  console.log(`   http://localhost:${PORT}/search?q=shape of you`);
});

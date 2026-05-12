const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.URL_SUPABASE;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_ANON_KEY;
const DB_PROVIDER = (process.env.DB_PROVIDER || (SUPABASE_URL && SUPABASE_KEY ? 'supabase' : 'mysql')).toLowerCase();

const mysqlConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'senai',
  database: process.env.DB_NAME || 'floripa_check',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

const supabaseConfig = {
  url: SUPABASE_URL,
  key: SUPABASE_KEY,
};

let pool;
let initPromise;
let databaseReady = false;

const seedPraias = [
  {
    nome: 'Praia Mole',
    bairro: 'Lagoa da Conceicao',
    descricao: 'Mar aberto, areia clara e clima jovem para quem curte surf e visual amplo.',
    imagem_url:
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
  },
  {
    nome: 'Joaquina',
    bairro: 'Leste da Ilha',
    descricao: 'Ondas fortes, dunas por perto e um dos cartoes-postais mais classicos de Floripa.',
    imagem_url:
      'https://images.unsplash.com/photo-1519046904884-53103b34b206?auto=format&fit=crop&w=1200&q=80',
  },
  {
    nome: 'Campeche',
    bairro: 'Sul da Ilha',
    descricao: 'Faixa longa de areia, agua viva e vista para a Ilha do Campeche.',
    imagem_url:
      'https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=1200&q=80',
  },
  {
    nome: 'Jurere Internacional',
    bairro: 'Norte da Ilha',
    descricao: 'Agua mais calma, boa estrutura e movimento elegante durante a temporada.',
    imagem_url:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
  },
  {
    nome: 'Barra da Lagoa',
    bairro: 'Norte da Ilha',
    descricao: 'Agua cristalina, piscinas naturais e bastante comercio.',
    imagem_url:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
  },
  {
    nome: 'Armacao',
    bairro: 'Sul da Ilha',
    descricao: 'Praia tradicional, com trapiche, barcos e acesso ao Matadeiro.',
    imagem_url:
      'https://media.istockphoto.com/id/1891909146/pt/foto/rocky-ocean-coastline-beach-and-ocean-with-waves-in-brazil-aerial-view-of-ponta-das-campanhas.jpg?s=2048x2048&w=is&k=20&c=tlCDLocj_IaviNxeo3w5HPYRcYuXeyAwwY2uM1aCEj0=',
  },
];

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'front')));

function parseCondicoes(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeAvaliacao(row) {
  return {
    ...row,
    nota: Number(row.nota),
    condicoes: parseCondicoes(row.condicoes),
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, originalHash] = String(storedHash || '').split(':');

  if (!salt || !originalHash) {
    return false;
  }

  const hash = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(originalHash, 'hex');

  return original.length === hash.length && crypto.timingSafeEqual(original, hash);
}

function validateAvaliacao(body) {
  const usuario = String(body.usuario || '').trim();
  const comentario = String(body.comentario || '').trim();
  const nota = Number(body.nota);
  const condicoes = Array.isArray(body.condicoes)
    ? body.condicoes.map((item) => String(item).trim()).filter(Boolean)
    : [];

  if (!usuario || usuario.length < 2) {
    return { error: 'Informe um nome com pelo menos 2 caracteres.' };
  }

  if (!Number.isFinite(nota) || nota < 1 || nota > 5) {
    return { error: 'A nota precisa estar entre 1 e 5.' };
  }

  if (!comentario || comentario.length < 8) {
    return { error: 'Escreva um comentario com pelo menos 8 caracteres.' };
  }

  if (condicoes.length === 0) {
    return { error: 'Selecione pelo menos uma condicao da praia.' };
  }

  return { usuario, comentario, nota, condicoes };
}

function sendServerError(res, error, fallbackMessage) {
  console.error(fallbackMessage, error);
  res.status(500).json({ error: `${fallbackMessage}: ${error.message}` });
}

function calculatePraiaStats(praias, avaliacoes) {
  return praias
    .map((praia) => {
      const reviews = avaliacoes.filter((avaliacao) => Number(avaliacao.praia_id) === Number(praia.id));
      const total = reviews.length;
      const media = total
        ? Math.round((reviews.reduce((sum, item) => sum + Number(item.nota), 0) / total) * 10) / 10
        : 0;

      return {
        ...praia,
        media,
        total_avaliacoes: total,
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: supabaseConfig.key,
    Authorization: `Bearer ${supabaseConfig.key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function supabaseRequest(pathname, options = {}) {
  if (!supabaseConfig.url || !supabaseConfig.key) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
  }

  const response = await fetch(`${supabaseConfig.url}/rest/v1/${pathname}`, {
    ...options,
    headers: supabaseHeaders(options.headers),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data && (data.message || data.details || data.hint);
    const error = new Error(message || 'Erro ao acessar o Supabase.');
    error.status = response.status;
    throw error;
  }

  return data;
}

async function initMysqlDatabase() {
  const bootstrap = await mysql.createConnection({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    ssl: mysqlConfig.ssl,
    multipleStatements: true,
  });

  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${mysqlConfig.database}\``);
  await bootstrap.end();

  pool = mysql.createPool(mysqlConfig);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS praias (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(120) NOT NULL,
      bairro VARCHAR(120) NOT NULL,
      descricao TEXT NOT NULL,
      imagem_url VARCHAR(600) NOT NULL,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS avaliacoes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      praia_id INT NOT NULL,
      usuario VARCHAR(120) NOT NULL,
      nota DECIMAL(2,1) NOT NULL,
      comentario TEXT NOT NULL,
      condicoes TEXT NOT NULL,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (praia_id) REFERENCES praias(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cadastros (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(120) NOT NULL,
      email VARCHAR(180) NOT NULL UNIQUE,
      senha_hash VARCHAR(255) NOT NULL,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS logins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cadastro_id INT NULL,
      email VARCHAR(180) NOT NULL,
      sucesso BOOLEAN NOT NULL DEFAULT FALSE,
      ip VARCHAR(80),
      user_agent VARCHAR(255),
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cadastro_id) REFERENCES cadastros(id) ON DELETE SET NULL
    )
  `);

  for (const praia of seedPraias) {
    await pool.query(
      `
        INSERT INTO praias (nome, bairro, descricao, imagem_url)
        SELECT ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM praias WHERE nome = ?)
      `,
      [praia.nome, praia.bairro, praia.descricao, praia.imagem_url, praia.nome]
    );
  }
}

async function initSupabaseDatabase() {
  for (const praia of seedPraias) {
    const found = await supabaseRequest(`praias?select=id&nome=eq.${encodeURIComponent(praia.nome)}`);

    if (!found.length) {
      await supabaseRequest('praias', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(praia),
      });
    }
  }
}

async function initDatabase() {
  if (databaseReady) return;

  if (DB_PROVIDER === 'supabase') {
    await initSupabaseDatabase();
  } else {
    await initMysqlDatabase();
  }

  databaseReady = true;
}

async function ensureDatabase(req, res, next) {
  try {
    if (!initPromise) {
      initPromise = initDatabase();
    }

    await initPromise;
    next();
  } catch (error) {
    res.status(500).json({ error: `Banco de dados indisponivel: ${error.message}` });
  }
}

async function getPraiasWithStats() {
  if (DB_PROVIDER === 'supabase') {
    const praias = await supabaseRequest('praias?select=*&order=nome.asc');
    const avaliacoes = await supabaseRequest('avaliacoes?select=*');
    return calculatePraiaStats(praias, avaliacoes.map(normalizeAvaliacao));
  }

  const [rows] = await pool.query(`
    SELECT
      p.id,
      p.nome,
      p.bairro,
      p.descricao,
      p.imagem_url,
      COALESCE(ROUND(AVG(a.nota), 1), 0) AS media,
      COUNT(a.id) AS total_avaliacoes
    FROM praias p
    LEFT JOIN avaliacoes a ON a.praia_id = p.id
    GROUP BY p.id
    ORDER BY p.nome ASC
  `);

  return rows.map((row) => ({
    ...row,
    media: Number(row.media),
    total_avaliacoes: Number(row.total_avaliacoes),
  }));
}

app.get('/api/health', ensureDatabase, async (req, res) => {
  res.json({
    status: 'ok',
    provider: DB_PROVIDER,
    database: DB_PROVIDER === 'supabase' ? 'supabase' : mysqlConfig.database,
    supabaseUrlConfigured: Boolean(supabaseConfig.url),
    supabaseKeyConfigured: Boolean(supabaseConfig.key),
  });
});

app.post('/api/cadastros', ensureDatabase, async (req, res) => {
  const nome = String(req.body.nome || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');

  if (!nome || !email || !senha) {
    return res.status(400).json({ error: 'Preencha nome, email e senha.' });
  }

  try {
    const cadastro = { nome, email, senha_hash: hashPassword(senha) };

    if (DB_PROVIDER === 'supabase') {
      const [created] = await supabaseRequest('cadastros', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(cadastro),
      });

      return res.status(201).json({
        id: created.id,
        nome: created.nome,
        email: created.email,
        message: 'Cadastro realizado com sucesso.',
      });
    }

    const [result] = await pool.query(
      'INSERT INTO cadastros (nome, email, senha_hash) VALUES (?, ?, ?)',
      [cadastro.nome, cadastro.email, cadastro.senha_hash]
    );

    res.status(201).json({
      id: result.insertId,
      nome,
      email,
      message: 'Cadastro realizado com sucesso.',
    });
  } catch (error) {
    if (error.status === 409 || error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Esse email ja esta cadastrado.' });
    }

    sendServerError(res, error, 'Nao foi possivel fazer seu cadastro');
  }
});

app.post('/api/login', ensureDatabase, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');
  const ip = req.ip;
  const userAgent = String(req.get('user-agent') || '').slice(0, 255);

  try {
    let usuario;

    if (DB_PROVIDER === 'supabase') {
      const rows = await supabaseRequest(
        `cadastros?select=id,nome,email,senha_hash&email=eq.${encodeURIComponent(email)}&limit=1`
      );
      usuario = rows[0];
    } else {
      const [rows] = await pool.query(
        'SELECT id, nome, email, senha_hash FROM cadastros WHERE email = ?',
        [email]
      );
      usuario = rows[0];
    }

    const sucesso = Boolean(usuario && verifyPassword(senha, usuario.senha_hash));
    const login = {
      cadastro_id: usuario ? usuario.id : null,
      email,
      sucesso,
      ip,
      user_agent: userAgent,
    };

    if (DB_PROVIDER === 'supabase') {
      await supabaseRequest('logins', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(login),
      });
    } else {
      await pool.query(
        'INSERT INTO logins (cadastro_id, email, sucesso, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
        [login.cadastro_id, login.email, login.sucesso, login.ip, login.user_agent]
      );
    }

    if (!sucesso) {
      return res.status(401).json({ error: 'Email ou senha invalidos.' });
    }

    res.json({
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      message: 'Login realizado com sucesso.',
    });
  } catch (error) {
    sendServerError(res, error, 'Nao foi possivel fazer login');
  }
});

app.get('/api/praias', ensureDatabase, async (req, res) => {
  try {
    res.json(await getPraiasWithStats());
  } catch (error) {
    sendServerError(res, error, 'Nao foi possivel listar as praias');
  }
});

app.get('/api/praias/:id', ensureDatabase, async (req, res) => {
  try {
    const praias = await getPraiasWithStats();
    const praia = praias.find((item) => Number(item.id) === Number(req.params.id));

    if (!praia) {
      return res.status(404).json({ error: 'Praia nao encontrada.' });
    }

    res.json(praia);
  } catch (error) {
    sendServerError(res, error, 'Nao foi possivel buscar a praia');
  }
});

app.post('/api/praias', ensureDatabase, async (req, res) => {
  const nome = String(req.body.nome || '').trim();
  const bairro = String(req.body.bairro || '').trim();
  const descricao = String(req.body.descricao || '').trim();
  const imagemUrl = String(req.body.imagem_url || '').trim();

  if (!nome || !bairro || !descricao || !imagemUrl) {
    return res.status(400).json({ error: 'Preencha nome, bairro, descricao e imagem_url.' });
  }

  try {
    if (DB_PROVIDER === 'supabase') {
      const [created] = await supabaseRequest('praias', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ nome, bairro, descricao, imagem_url: imagemUrl }),
      });

      return res.status(201).json(created);
    }

    const [result] = await pool.query(
      'INSERT INTO praias (nome, bairro, descricao, imagem_url) VALUES (?, ?, ?, ?)',
      [nome, bairro, descricao, imagemUrl]
    );

    res.status(201).json({ id: result.insertId, nome, bairro, descricao, imagem_url: imagemUrl });
  } catch (error) {
    sendServerError(res, error, 'Nao foi possivel cadastrar a praia');
  }
});

app.get('/api/praias/:id/avaliacoes', ensureDatabase, async (req, res) => {
  try {
    if (DB_PROVIDER === 'supabase') {
      const rows = await supabaseRequest(
        `avaliacoes?select=*&praia_id=eq.${encodeURIComponent(req.params.id)}&order=criado_em.desc`
      );
      return res.json(rows.map(normalizeAvaliacao));
    }

    const [rows] = await pool.query(
      `
        SELECT id, praia_id, usuario, nota, comentario, condicoes, criado_em
        FROM avaliacoes
        WHERE praia_id = ?
        ORDER BY criado_em DESC
      `,
      [req.params.id]
    );

    res.json(rows.map(normalizeAvaliacao));
  } catch (error) {
    sendServerError(res, error, 'Nao foi possivel listar as avaliacoes');
  }
});

app.post('/api/praias/:id/avaliacoes', ensureDatabase, async (req, res) => {
  const valid = validateAvaliacao(req.body);

  if (valid.error) {
    return res.status(400).json({ error: valid.error });
  }

  try {
    const avaliacao = {
      praia_id: Number(req.params.id),
      usuario: valid.usuario,
      nota: valid.nota,
      comentario: valid.comentario,
      condicoes: DB_PROVIDER === 'supabase' ? valid.condicoes : JSON.stringify(valid.condicoes),
    };

    if (DB_PROVIDER === 'supabase') {
      const praias = await supabaseRequest(`praias?select=id&id=eq.${encodeURIComponent(req.params.id)}&limit=1`);

      if (!praias.length) {
        return res.status(404).json({ error: 'Praia nao encontrada.' });
      }

      const [created] = await supabaseRequest('avaliacoes', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(avaliacao),
      });

      return res.status(201).json(normalizeAvaliacao(created));
    }

    const [praias] = await pool.query('SELECT id FROM praias WHERE id = ?', [req.params.id]);

    if (!praias.length) {
      return res.status(404).json({ error: 'Praia nao encontrada.' });
    }

    const [result] = await pool.query(
      `
        INSERT INTO avaliacoes (praia_id, usuario, nota, comentario, condicoes)
        VALUES (?, ?, ?, ?, ?)
      `,
      [avaliacao.praia_id, avaliacao.usuario, avaliacao.nota, avaliacao.comentario, avaliacao.condicoes]
    );

    res.status(201).json({
      id: result.insertId,
      praia_id: avaliacao.praia_id,
      usuario: valid.usuario,
      nota: valid.nota,
      comentario: valid.comentario,
      condicoes: valid.condicoes,
    });
  } catch (error) {
    sendServerError(res, error, 'Nao foi possivel salvar a avaliacao');
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'front', 'index.html'));
});

if (require.main === module) {
  initDatabase()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Floripa Check rodando em http://localhost:${PORT}`);
      });
    })
    .catch((error) => {
      console.error('Erro ao iniciar o banco de dados:', error.message);
      process.exit(1);
    });
}

module.exports = app;

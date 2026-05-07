// Bibliotecas usadas pelo servidor.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

// Cria o app Express e define a porta do servidor.
const app = express();
const PORT = process.env.PORT || 3000;

// Configuracao da conexao com o MySQL.
// Se existir variavel de ambiente, usa ela; se nao existir, usa o valor depois do ||.
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'floripa_check',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

// Pool e a conexao reutilizavel com o banco.
let pool;

// Praias iniciais do sistema.
// Quando o servidor inicia, ele cadastra essas praias se elas ainda nao existirem no MySQL.
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
    descricao: 'Ondas fortes, dunas por perto e um dos cartões-postais mais classicos de Floripa.',
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
    nome: 'Jurerê Internacional',
    bairro: 'Norte da Ilha',
    descricao: 'Agua mais calma, boa estrutura e movimento elegante durante a temporada.',
    imagem_url:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
  },

  {
    nome: 'Barra da lagoa',
    bairro: 'Norte da Ilha',
    descricao: 'Agua cristalina, pscinas naturais, bastanta comércio',
    imagem_url:'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
},

  {
    nome: 'Armação',
    bairro: 'Sul da ilha',
    descricao: 'Agua cristalina, pscinas naturais, bastanta comércio, trapiche',
    imagem_url:'https://media.istockphoto.com/id/1891909146/pt/foto/rocky-ocean-coastline-beach-and-ocean-with-waves-in-brazil-aerial-view-of-ponta-das-campanhas.jpg?s=2048x2048&w=is&k=20&c=tlCDLocj_IaviNxeo3w5HPYRcYuXeyAwwY2uM1aCEj0=',
},
 
];

// Middlewares do Express.
// cors permite requisicoes da interface; json permite receber dados em JSON;
// static faz o backend servir os arquivos da pasta front.
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'front')));

// Converte as condicoes salvas no banco de texto JSON para array JavaScript.
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

// Ajusta os dados de uma avaliacao antes de enviar para o frontend.
function normalizeAvaliacao(row) {
  return {
    ...row,
    nota: Number(row.nota),
    condicoes: parseCondicoes(row.condicoes),
  };
}

// Cria um hash seguro para senha usando salt.
// Assim a senha real nao fica salva no banco.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// Compara a senha digitada no login com o hash salvo no banco.
function verifyPassword(password, storedHash) {
  const [salt, originalHash] = String(storedHash || '').split(':');

  if (!salt || !originalHash) {
    return false;
  }

  const hash = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(originalHash, 'hex');

  return original.length === hash.length && crypto.timingSafeEqual(original, hash);
}

// Valida os dados enviados pelo formulario de avaliacao.
// Se algo estiver errado, retorna uma mensagem de erro.
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

// Inicializa o banco:
// 1. cria o database se nao existir;
// 2. cria as tabelas;
// 3. cadastra as praias iniciais.
async function initDatabase() {
  const bootstrap = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    ssl: dbConfig.ssl,
    multipleStatements: true,
  });

  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\``);
  await bootstrap.end();

  pool = mysql.createPool(dbConfig);

  // Tabela de praias, de avaliações/comentarios e cadastro e login
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

  // Tabela das avaliacoes/comentarios de cada praia.
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

  // Tabela de usuarios cadastrados.
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

  // Tabela que registra tentativas de login.
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

  // Insere as praias do seedPraias apenas se elas ainda nao existirem.
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

// Rota para testar se API e banco estao funcionando.
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: dbConfig.database });
  } catch (error) {
    res.status(500).json({ error: 'Banco de dados indisponivel.' });
  }
});

// rota pro cadastro

app.post('/api/cadastros', async (req, res) => {
  const nome = String(req.body.nome || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');

  if (!nome || !email || !senha){
    return res.status(400).json({ error: 'Preencha nome, email, e senha seu cagalha'});
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO cadastros (nome, email, senha_hash) VALUES (?, ?, ?)',
      [nome, email, hashPassword(senha)]
    );
  
    res.status(201).json({
      id: result.insertId,
      nome,
      email,
      message: 'Cadastro realizado com sucess'
    
    });
  
  } catch (error) {
    res.status(500).json({ error : 'Não foi possivel fazer seu cadastro.'});
  }


  });

  //rota pro login
app.post('/api/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');
  const ip = req.ip;
  const userAgent = String(req.get('user-agent') || '').slice(0, 255);

  try {
    const [rows] = await pool.query(
      'SELECT id, nome, email, senha_hash FROM cadastros WHERE email = ?',
      [email]
    );

    const usuario = rows[0];
    const sucesso = Boolean(usuario && verifyPassword(senha, usuario.senha_hash));

    await pool.query(
      'INSERT INTO logins (cadastro_id, email, sucesso, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
      [usuario ? usuario.id : null, email, sucesso, ip, userAgent]
    );

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
    res.status(500).json({ error: 'Nao foi possivel fazer login.' });
  }
});


// Lista todas as praias com media de nota e total de avaliacoes.
app.get('/api/praias', async (req, res) => {
  try {
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

    res.json(rows.map((row) => ({
      ...row,
      media: Number(row.media),
      total_avaliacoes: Number(row.total_avaliacoes),
    })));
  } catch (error) {
    res.status(500).json({ error: 'Nao foi possivel listar as praias.' });
  }
});

// Busca uma praia especifica pelo id.
app.get('/api/praias/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `
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
        WHERE p.id = ?
        GROUP BY p.id
      `,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Praia nao encontrada.' });
    }

    const praia = rows[0];
    res.json({
      ...praia,
      media: Number(praia.media),
      total_avaliacoes: Number(praia.total_avaliacoes),
    });
  } catch (error) {
    res.status(500).json({ error: 'Nao foi possivel buscar a praia.' });
  }
});

// cadastrar praia nova 
app.post('/api/praias', async (req, res) => {
  const nome = String(req.body.nome || '').trim();
  const bairro = String(req.body.bairro || '').trim();
  const descricao = String(req.body.descricao || '').trim();
  const imagemUrl = String(req.body.imagem_url || '').trim();

  if (!nome || !bairro || !descricao || !imagemUrl) {
    return res.status(400).json({ error: 'Preencha nome, bairro, descricao e imagem_url.' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO praias (nome, bairro, descricao, imagem_url) VALUES (?, ?, ?, ?)',
      [nome, bairro, descricao, imagemUrl]
    );

    res.status(201).json({ id: result.insertId, nome, bairro, descricao, imagem_url: imagemUrl });
  } catch (error) {
    res.status(500).json({ error: 'Nao foi possivel cadastrar a praia.' });
  }
});

// Lista as avaliacoes de uma praia.
app.get('/api/praias/:id/avaliacoes', async (req, res) => {
  try {
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
    res.status(500).json({ error: 'Nao foi possivel listar as avaliacoes.' });
  }
});

// Salva uma nova avaliacao para uma praia.
app.post('/api/praias/:id/avaliacoes', async (req, res) => {
  const valid = validateAvaliacao(req.body);

  if (valid.error) {
    return res.status(400).json({ error: valid.error });
  }

  try {
    const [praias] = await pool.query('SELECT id FROM praias WHERE id = ?', [req.params.id]);

    if (praias.length === 0) {
      return res.status(404).json({ error: 'Praia nao encontrada.' });
    }

    const [result] = await pool.query(
      `
        INSERT INTO avaliacoes (praia_id, usuario, nota, comentario, condicoes)
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        req.params.id,
        valid.usuario,
        valid.nota,
        valid.comentario,
        JSON.stringify(valid.condicoes),
      ]
    );

    res.status(201).json({
      id: result.insertId,
      praia_id: Number(req.params.id),
      usuario: valid.usuario,
      nota: valid.nota,
      comentario: valid.comentario,
      condicoes: valid.condicoes,
    });
  } catch (error) {
    res.status(500).json({ error: 'Nao foi possivel salvar a avaliacao.' });
  }
});

// Se a rota nao for da API, envia o index.html do frontend.
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'front', 'index.html'));
});

// Inicia o servidor se der errado quebra
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

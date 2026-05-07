const API_URL = '';

const condicoes = [
  'Limpa',
  'Cheia',
  'Tranquila',
  'Mar agitado',
  'Agua calma',
  'Boa para surf',
  'Com vento',
  'Familiar',
  'Agradavel',
];

const state = {
  praias: [],
  avaliacoes: {},
  campoBusca: '',
  condition: '',
};

const praiasEl = document.querySelector('#praias');
const praiaSelect = document.querySelector('#praiaSelect');
const comentariosList = document.querySelector('#comentariosList');
const conditionChips = document.querySelector('#conditionChips');
const campoBuscaInput = document.querySelector('#campoBuscaInput');
const conditionFilter = document.querySelector('#conditionFilter');
const reviewForm = document.querySelector('#reviewForm');
const formMessage = document.querySelector('#formMessage');
const notaInput = document.querySelector('#notaInput');
const ratingPreview = document.querySelector('#ratingPreview');

function stars(value) {
  const nota = Math.round(Number(value) || 0);
  return '★'.repeat(nota).padEnd(5, '☆');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

async function request(endpoint, options) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Algo deu errado.');
  }

  return data;
}

async function loadPraias() {
  state.praias = await request('/api/praias');

  await Promise.all(
    state.praias.map(async (praia) => {
      state.avaliacoes[praia.id] = await request(`/api/praias/${praia.id}/avaliacoes`);
    })
  );

  renderPraias();
  renderSelect();
  renderComments();
}

function praiaMatchesFilter(praia) {
  const text = `${praia.nome} ${praia.bairro}`.toLowerCase();
  const matchesSearch = text.includes(state.campoBusca.toLowerCase());
  const reviews = state.avaliacoes[praia.id] || [];
  const matchesCondition =
    !state.condition ||
    reviews.some((review) => review.condicoes.includes(state.condition));

  return matchesSearch && matchesCondition;
}

function renderPraias() {
  const filtered = state.praias.filter(praiaMatchesFilter);

  praiasEl.innerHTML = filtered
    .map((praia) => {
      const reviews = state.avaliacoes[praia.id] || [];
      const latest = reviews[0];
      const condicoesMarkup = latest
        ? latest.condicoes.map((item) => `<span>${escapeHtml(item)}</span>`).join('')
        : '<span>Sem relatos ainda</span>';

      return `
        <article class="cartao-praia">
          <img src="${escapeHtml(praia.imagem_url)}" alt="${escapeHtml(praia.nome)}" />
          <div class="conteudo-praia">
            <div class="cabecalho-praia">
              <div>
                <h3>${escapeHtml(praia.nome)}</h3>
                <p>${escapeHtml(praia.bairro)}</p>
              </div>
              <strong title="Média de avaliações">${praia.media || '0.0'}</strong>
            </div>
            <p>${escapeHtml(praia.descricao)}</p>
            <div class="condicoes">${condicoesMarkup}</div>
            <footer>
              <span>${stars(praia.media)}</span>
              <small>${praia.total_avaliacoes} avaliação(ões)</small>
            </footer>
          </div>
        </article>
      `;
    })
    .join('');

  if (!filtered.length) {
    praiasEl.innerHTML = '<p class="vazio">Nenhuma praia encontrada para esse filtro.</p>';
  }
}

function renderSelect() {
  praiaSelect.innerHTML = state.praias
    .map((praia) => `<option value="${praia.id}">${escapeHtml(praia.nome)}</option>`)
    .join('');
}

function renderConditionChips() {
  conditionChips.innerHTML = condicoes
    .map(
      (condition) => `
        <label class="opcao-condicao">
          <input type="checkbox" value="${escapeHtml(condition)}" />
          <span>${escapeHtml(condition)}</span>
        </label>
      `
    )
    .join('');
}

function renderComments() {
  const allReviews = state.praias
    .flatMap((praia) =>
      (state.avaliacoes[praia.id] || []).map((review) => ({ ...review, praia: praia.nome }))
    )
    .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))
    .slice(0, 6);

  comentariosList.innerHTML = allReviews.length
    ? allReviews
        .map(
          (review) => `
            <article class="comentario">
              <div>
                <strong>${escapeHtml(review.usuario)}</strong>
                <span>${escapeHtml(review.praia)} • ${formatDate(review.criado_em)}</span>
              </div>
              <p>${escapeHtml(review.comentario)}</p>
              <small>${stars(review.nota)} · ${escapeHtml(review.condicoes.join(', '))}</small>
            </article>
          `
        )
        .join('')
    : '<p class="vazio">Ainda não há comentários. Seja a primeira pessoa a avaliar.</p>';
}

function setMessage(text, type = 'info') {
  formMessage.textContent = text;
  formMessage.dataset.type = type;
}

campoBuscaInput.addEventListener('input', (event) => {
  state.campoBusca = event.target.value;
  renderPraias();
});

conditionFilter.addEventListener('change', (event) => {
  state.condition = event.target.value;
  renderPraias();
});

notaInput.addEventListener('input', () => {
  const label = Number(notaInput.value) === 1 ? '1 estrela' : `${notaInput.value} estrelas`;
  ratingPreview.textContent = label;
});

reviewForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const praiaId = praiaSelect.value;
  const selectedConditions = [...conditionChips.querySelectorAll('input:checked')].map(
    (input) => input.value
  );

  const payload = {
    usuario: document.querySelector('#usuarioInput').value,
    nota: notaInput.value,
    comentario: document.querySelector('#comentarioInput').value,
    condicoes: selectedConditions,
  };

  try {
    setMessage('Enviando avaliação...');
    await request(`/api/praias/${praiaId}/avaliacoes`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    reviewForm.reset();
    notaInput.value = 5;
    ratingPreview.textContent = '5 estrelas';
    setMessage('Avaliação publicada com sucesso.', 'success');
    await loadPraias();
  } catch (error) {
    setMessage(error.message, 'error');
  }
});

renderConditionChips();
setMessage('');
loadPraias().catch((error) => {
  praiasEl.innerHTML = `
    <p class="vazio">
      Não foi possível carregar as praias. Confira se o servidor e o MySQL estão rodando.
    </p>
  `;
  setMessage(error.message, 'error');
});

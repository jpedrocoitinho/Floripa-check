// Pega os botoes das abas "Entrar" e "Criar conta".
const tabs = document.querySelectorAll('.aba-autenticacao');

// Pega os dois formularios da tela.
const forms = document.querySelectorAll('.formulario-autenticacao');
const loginForm = document.querySelector('#loginForm');
const signupForm = document.querySelector('#signupForm');

// Pega o paragrafo onde aparecem mensagens de erro/sucesso.
const authMessage = document.querySelector('#authMessage');

// Mostra uma mensagem na tela.
function setAuthMessage(text, type = 'info') {
  authMessage.textContent = text;
  authMessage.dataset.type = type;
}

// Troca entre formulario de login e formulario de cadastro.
function showForm(formId) {
  tabs.forEach((tab) => {
    const isActive = tab.dataset.target === formId;
    tab.classList.toggle('ativo', isActive);
  });

  forms.forEach((form) => {
    const isActive = form.id === formId;
    form.classList.toggle('ativo', isActive);
  });

  setAuthMessage('');
}

// Funcao reutilizavel para mandar dados para o backend.
async function sendToApi(endpoint, payload) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Nao foi possivel concluir a acao.');
  }

  return data;
}

// Faz os botoes das abas funcionarem.
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    showForm(tab.dataset.target);
  });
});

// Quando enviar o formulario de cadastro, chama a rota POST /api/cadastros.
signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    nome: document.querySelector('#signupName').value,
    email: document.querySelector('#signupEmail').value,
    senha: document.querySelector('#signupPassword').value,
  };

  try {
    setAuthMessage('Criando sua conta...');

    await sendToApi('/api/cadastros', payload);

    signupForm.reset();
    showForm('loginForm');
    document.querySelector('#loginEmail').value = payload.email;
    setAuthMessage('Cadastro feito. Agora entre com sua senha.', 'success');
  } catch (error) {
    setAuthMessage(error.message, 'error');
  }
});

// Quando enviar o formulario de login, chama a rota POST /api/login.
loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    email: document.querySelector('#loginEmail').value,
    senha: document.querySelector('#loginPassword').value,
  };

  try {
    setAuthMessage('Entrando...');

    const usuario = await sendToApi('/api/login', payload);

    // Guarda o usuario logado no navegador para o front conseguir usar depois.
    localStorage.setItem('floripaCheckUser', JSON.stringify(usuario));

    setAuthMessage(`Login feito com sucesso. Bem-vindo, ${usuario.nome}.`, 'success');

    setTimeout(() => {
      window.location.href = 'index.html';
    }, 900);
  } catch (error) {
    setAuthMessage(error.message, 'error');
  }
});

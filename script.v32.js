/*
  ERP Escolar — Helpers globais
  Arquivo extraído da base v32 sem alterar lógica.
  Mantém funções utilitárias, normalização, segurança de HTML/URL,
  modais e funções de API REST.
*/

// --- HELPERS GERAIS ---
function hojeISO() {
  return new Date().toISOString().split('T')[0];
}

function formatarDataBR(dataISO) {
  const texto = String(dataISO || '').substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return '';
  const [ano, mes, dia] = texto.split('-');
  return `${dia}/${mes}/${ano}`;
}

function partesDataISO(dataISO) {
  const texto = String(dataISO || '').substring(0, 10);
  const match = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const ano = Number(match[1]);
  const mes = Number(match[2]);
  const dia = Number(match[3]);
  const data = new Date(ano, mes - 1, dia);

  if (
    data.getFullYear() !== ano ||
    data.getMonth() !== mes - 1 ||
    data.getDate() !== dia
  ) {
    return null;
  }

  return { ano, mes, dia, data, iso: texto };
}

function calcularIdadePorNascimento(dataISO, baseDate = new Date()) {
  const nascimento = partesDataISO(dataISO);
  if (!nascimento) return null;

  const hoje = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const dataNascimento = new Date(nascimento.ano, nascimento.mes - 1, nascimento.dia);
  if (dataNascimento > hoje) return null;

  let idade = hoje.getFullYear() - nascimento.ano;
  const aniversarioJaPassou =
    hoje.getMonth() + 1 > nascimento.mes ||
    (hoje.getMonth() + 1 === nascimento.mes && hoje.getDate() >= nascimento.dia);

  if (!aniversarioJaPassou) idade -= 1;
  return idade >= 0 && idade <= 120 ? idade : null;
}

function obterProximoAniversarioInfo(dataISO, baseDate = new Date()) {
  const nascimento = partesDataISO(dataISO);
  if (!nascimento) return null;

  const hoje = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  if (new Date(nascimento.ano, nascimento.mes - 1, nascimento.dia) > hoje) return null;

  let proximo = new Date(hoje.getFullYear(), nascimento.mes - 1, nascimento.dia);
  if (proximo < hoje) proximo = new Date(hoje.getFullYear() + 1, nascimento.mes - 1, nascimento.dia);

  const dias = Math.round((proximo - hoje) / 86400000);
  const idadeAoCompletar = proximo.getFullYear() - nascimento.ano;
  const proximoISO = `${proximo.getFullYear()}-${String(proximo.getMonth() + 1).padStart(2, '0')}-${String(proximo.getDate()).padStart(2, '0')}`;

  return {
    dias,
    hoje: dias === 0,
    proximoISO,
    proximoBR: formatarDataBR(proximoISO),
    idadeAoCompletar,
    label: dias === 0 ? `Hoje completa ${idadeAoCompletar} ano(s)` : dias === 1 ? `Amanhã completa ${idadeAoCompletar} ano(s)` : `Em ${dias} dias completa ${idadeAoCompletar} ano(s)`
  };
}

function formatarIdadeCalculada(idade) {
  return Number.isInteger(idade) ? `${idade} ano${idade === 1 ? '' : 's'}` : 'Idade não informada';
}

function normalizarTexto(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

function normalizarNomeBusca(valor) {
  return normalizarTexto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function contemNomeESobrenome(valor) {
  return normalizarNomeBusca(valor).split(' ').filter(Boolean).length >= 2;
}

function obterTokensNomeBusca(valor) {
  return normalizarNomeBusca(valor).split(' ').filter(Boolean);
}

function calcularDistanciaLevenshtein(a, b) {
  const textoA = String(a || '');
  const textoB = String(b || '');
  if (textoA === textoB) return 0;
  if (!textoA.length) return textoB.length;
  if (!textoB.length) return textoA.length;

  const anterior = Array.from({ length: textoB.length + 1 }, (_, i) => i);
  const atual = new Array(textoB.length + 1);

  for (let i = 1; i <= textoA.length; i++) {
    atual[0] = i;
    for (let j = 1; j <= textoB.length; j++) {
      const custo = textoA[i - 1] === textoB[j - 1] ? 0 : 1;
      atual[j] = Math.min(
        atual[j - 1] + 1,
        anterior[j] + 1,
        anterior[j - 1] + custo
      );
    }
    for (let j = 0; j <= textoB.length; j++) anterior[j] = atual[j];
  }

  return anterior[textoB.length];
}

function calcularScoreNomeAluno(entrada, nomeAluno) {
  const busca = normalizarNomeBusca(entrada);
  const alvo = normalizarNomeBusca(nomeAluno);
  if (!busca || !alvo) return 0;
  if (busca === alvo) return 1;

  const tokensBusca = obterTokensNomeBusca(busca);
  const tokensAlvo = obterTokensNomeBusca(alvo);
  if (!tokensBusca.length || !tokensAlvo.length) return 0;

  const maxLen = Math.max(busca.length, alvo.length, 1);
  const distancia = calcularDistanciaLevenshtein(busca, alvo);
  const similaridadeTexto = Math.max(0, 1 - (distancia / maxLen));

  const coberturaTokens = tokensBusca.reduce((total, tokenBusca) => {
    const melhorToken = tokensAlvo.reduce((melhor, tokenAlvo) => {
      if (tokenAlvo === tokenBusca) return Math.max(melhor, 1);
      if (tokenAlvo.startsWith(tokenBusca) || tokenBusca.startsWith(tokenAlvo)) return Math.max(melhor, 0.88);
      const tokenMaxLen = Math.max(tokenBusca.length, tokenAlvo.length, 1);
      const tokenScore = Math.max(0, 1 - (calcularDistanciaLevenshtein(tokenBusca, tokenAlvo) / tokenMaxLen));
      return Math.max(melhor, tokenScore >= 0.72 ? tokenScore : 0);
    }, 0);
    return total + melhorToken;
  }, 0) / tokensBusca.length;

  const primeiroConfere = tokensBusca[0] && tokensAlvo[0]
    ? (tokensAlvo[0] === tokensBusca[0] || tokensAlvo[0].startsWith(tokensBusca[0]) || tokensBusca[0].startsWith(tokensAlvo[0]))
    : false;

  const ultimoBusca = tokensBusca[tokensBusca.length - 1];
  const ultimoConfere = ultimoBusca && tokensAlvo.some(token => {
    if (token === ultimoBusca || token.startsWith(ultimoBusca) || ultimoBusca.startsWith(token)) return true;
    const tokenMaxLen = Math.max(token.length, ultimoBusca.length, 1);
    return (1 - (calcularDistanciaLevenshtein(token, ultimoBusca) / tokenMaxLen)) >= 0.78;
  });

  let score = (similaridadeTexto * 0.42) + (coberturaTokens * 0.58);
  if (alvo.includes(busca) || busca.includes(alvo)) score = Math.max(score, 0.9);
  if (primeiroConfere && ultimoConfere) score = Math.max(score, 0.86);
  if (!primeiroConfere && tokensBusca[0]?.length >= 3) score -= 0.12;

  return Math.max(0, Math.min(1, score));
}

function classificarConfiancaNomeAluno(score, exact = false) {
  if (exact || score >= 0.985) return 'exata';
  if (score >= 0.88) return 'alta';
  if (score >= 0.72) return 'media';
  return 'baixa';
}

function formatarNomeProfessora(nome) {
  const texto = normalizarTexto(nome);
  if (!texto) return '';
  const semTitulo = texto.replace(/^(tia|professora|prof\.?|teacher)\s+/i, '').trim();
  const primeiroNome = (semTitulo || texto).split(/\s+/)[0] || '';
  return primeiroNome ? `Tia ${primeiroNome}` : texto;
}

function valorOuNull(valor) {
  const texto = normalizarTexto(valor);
  return texto || null;
}

function obterTokenAtual() {
  if (typeof window !== 'undefined' && window.app?.authSession?.access_token) {
    return window.app.authSession.access_token;
  }
  return SUPABASE_ANON_KEY;
}

function escapeHTML(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(valor) {
  return escapeHTML(valor).replaceAll('`', '&#096;');
}

function safeUrl(valor) {
  const url = String(valor || '').trim();
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/')) return url;
  return '';
}

function criarAvatarPadrao(nome) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(nome || 'aluno')}&backgroundColor=b6e3f4`;
}

function refreshIcons() {
  if (typeof lucide !== 'undefined' && lucide.icons && Object.keys(lucide.icons).length) {
    lucide.createIcons();
  }
}


const APP_MODAL_IDS = [
  'modal-create-choice',
  'modal-gallery-photo',
  'modal-attendance',
  'modal-add-student',
  'modal-profile',
  'modal-edit-student',
  'modal-achievement',
  'modal-achievements-list',
  'modal-activity-create',
  'modal-activities-list'
];

function modalEstaAberto(id) {
  const el = document.getElementById(id);
  return !!el && !el.classList.contains('hidden-view');
}

function syncBodyScrollLock() {
  const existeModalAberto = APP_MODAL_IDS.some(modalEstaAberto);
  document.body.classList.toggle('overflow-hidden', existeModalAberto);
}

function lockBodyScroll() {
  document.body.classList.add('overflow-hidden');
}

function unlockBodyScrollIfNoModal() {
  requestAnimationFrame(syncBodyScrollLock);
}

function parseActivityDescription(descricao) {
  const texto = String(descricao || '');
  const partes = texto.split('—');
  if (partes.length > 1) {
    return { tipo: partes[0].trim() || 'Atividade', texto: partes.slice(1).join('—').trim() || texto };
  }
  return { tipo: 'Atividade', texto };
}


const ACHIEVEMENT_TYPES = {
  Cordial: { label: 'Cordialidade', shortLabel: 'Cordial', icon: '😊', lucide: 'smile-plus', colors: 'bg-sky-50 border-sky-100', text: 'text-sky-700', glow: 'shadow-sky-100' },
  Cooperativo: { label: 'Cooperação', shortLabel: 'Cooperou', icon: '🤝', lucide: 'handshake', colors: 'bg-emerald-50 border-emerald-100', text: 'text-emerald-700', glow: 'shadow-emerald-100' },
  Participativo: { label: 'Participação', shortLabel: 'Participou', icon: '🙋', lucide: 'badge-check', colors: 'bg-indigo-50 border-indigo-100', text: 'text-indigo-700', glow: 'shadow-indigo-100' },
  Leitura: { label: 'Leitura', shortLabel: 'Leitura', icon: '📚', lucide: 'book-open-check', colors: 'bg-violet-50 border-violet-100', text: 'text-violet-700', glow: 'shadow-violet-100' },
  Criatividade: { label: 'Criatividade', shortLabel: 'Criativo', icon: '🎨', lucide: 'palette', colors: 'bg-pink-50 border-pink-100', text: 'text-pink-700', glow: 'shadow-pink-100' },
  Super: { label: 'Destaque do dia', shortLabel: 'Destaque', icon: '🏆', lucide: 'trophy', colors: 'bg-amber-50 border-amber-100', text: 'text-amber-700', glow: 'shadow-amber-100' },
  Desordem: { label: 'Ocorrência', shortLabel: 'Ocorrência', icon: '⚠️', lucide: 'alert-triangle', colors: 'bg-red-50 border-red-100', text: 'text-red-700', glow: 'shadow-red-100' },
  Conquista: { label: 'Conquista', shortLabel: 'Conquista', icon: '⭐', lucide: 'award', colors: 'bg-slate-50 border-slate-100', text: 'text-slate-700', glow: 'shadow-slate-100' }
};

function getAchievementConfig(tipo) {
  return ACHIEVEMENT_TYPES[tipo] || ACHIEVEMENT_TYPES.Conquista;
}


function calcularMetricasAluno(aluno) {
  const chamadas = Object.values(aluno?.attendance || {}).filter(Boolean);
  const totalChamadas = chamadas.length;
  const presencas = chamadas.filter(status => status === 'presente').length;
  const faltas = chamadas.filter(status => status === 'ausente').length;
  const presencaPct = totalChamadas ? Math.round((presencas / totalChamadas) * 100) : 0;

  const conquistas = Array.isArray(aluno?.achievements) ? aluno.achievements : [];
  const atividades = Array.isArray(aluno?.activities) ? aluno.activities : [];
  const ocorrencias = conquistas.filter(item => item.tipo === 'Desordem').length;
  const positivas = Math.max(conquistas.length - ocorrencias, 0);
  const comportamentoPct = conquistas.length ? Math.round((positivas / conquistas.length) * 100) : 0;

  const presencaNivel = !totalChamadas ? 'Sem registros' : presencaPct >= 90 ? 'Excelente' : presencaPct >= 75 ? 'Atenção leve' : 'Acompanhar presença';
  const comportamentoNivel = !conquistas.length ? 'Sem registros' : ocorrencias === 0 ? 'Positivo' : ocorrencias <= 2 ? 'Acompanhar' : 'Requer atenção';
  const atividadeNivel = atividades.length === 0 ? 'Sem atividades' : atividades.length >= 5 ? 'Bem documentado' : 'Em evolução';

  return {
    totalChamadas,
    presencas,
    faltas,
    presencaPct,
    conquistas: conquistas.length,
    atividades: atividades.length,
    ocorrencias,
    positivas,
    comportamentoPct,
    presencaNivel,
    comportamentoNivel,
    atividadeNivel,
    ultimaConquista: conquistas[0] || null,
    ultimaAtividade: atividades[0] || null
  };
}


function formatarErro(error, contexto = 'Operação') {
  if (!error) return `${contexto}: erro desconhecido.`;
  const partes = [
    `${contexto} falhou.`,
    error.message ? `Mensagem: ${error.message}` : '',
    error.code ? `Código: ${error.code}` : '',
    error.details ? `Detalhes: ${error.details}` : '',
    error.hint ? `Dica: ${error.hint}` : ''
  ].filter(Boolean);
  return partes.join('\n');
}

function mostrarErro(error, contexto) {
  console.error(contexto, error);
  alert(formatarErro(error, contexto));
}

function buildHeaders(extra = {}) {
  const tokenAtual = obterTokenAtual();
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${tokenAtual}`,
    'Accept-Profile': DB_SCHEMA,
    'Content-Profile': DB_SCHEMA,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    ...extra
  };
}

async function lerErroHTTP(resposta) {
  let corpo = '';
  try {
    corpo = await resposta.text();
    const json = JSON.parse(corpo);
    const erro = new Error(json.message || `Erro HTTP ${resposta.status}`);
    erro.code = json.code;
    erro.details = json.details;
    erro.hint = json.hint;
    return erro;
  } catch (_) {
    return new Error(corpo || `Erro HTTP ${resposta.status}`);
  }
}

// Leitura sempre sem cache, com schema explícito.
// Importante: não adicionar parâmetros artificiais como _cb na URL do PostgREST.
// O Supabase interpreta qualquer query param desconhecido como filtro de coluna.
async function fetchDiretoDaAPI(tabela, queryStr = '*', filtros = '') {
  const queryExtra = filtros ? `&${filtros}` : '';
  const url = `${SUPABASE_URL}/rest/v1/${tabela}?select=${queryStr}${queryExtra}`;

  const resposta = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    headers: buildHeaders()
  });

  if (!resposta.ok) throw await lerErroHTTP(resposta);
  return await resposta.json();
}

// Mutação via REST direto. Evita alterações apenas locais e força retorno real do banco.
// Não usa cache buster na URL para não gerar erro PGRST100 no Supabase/PostgREST.
async function mutateDiretoDaAPI(tabela, method, payload = null, query = '', prefer = 'return=representation') {
  const url = query
    ? `${SUPABASE_URL}/rest/v1/${tabela}?${query}`
    : `${SUPABASE_URL}/rest/v1/${tabela}`;

  const options = {
    method,
    cache: 'no-store',
    headers: buildHeaders({
      'Content-Type': 'application/json',
      'Prefer': prefer
    })
  };

  if (payload !== null) options.body = JSON.stringify(payload);

  const resposta = await fetch(url, options);
  if (!resposta.ok) throw await lerErroHTTP(resposta);

  if (resposta.status === 204) return null;
  const texto = await resposta.text();
  return texto ? JSON.parse(texto) : null;
}

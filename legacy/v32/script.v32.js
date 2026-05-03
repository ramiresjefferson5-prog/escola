// --- CONFIGURAÇÃO DA API / SUPABASE ---
const SUPABASE_URL = 'https://lqfwpfaqcnfsybxchmtg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxZndwZmFxY25mc3lieGNobXRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2ODk5MjIsImV4cCI6MjA5MDI2NTkyMn0.XMO-YQIzULWK2yMFoqdBVP-wYPA7P84sp4QnsuS0hks';
const DB_SCHEMA = 'gestao_escola';
const STORAGE_BUCKET = 'avatars';
const GALLERY_BUCKET = 'galeria';
const APP_VERSION = '2026-05-01-erp-app-v28-social-polido';

// Cliente Supabase usado para Auth e Storage. As operações de tabela continuam via REST direto.
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: DB_SCHEMA },
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

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

// --- CONTROLO DE ESTADO DA APLICAÇÃO ---
const app = {
  role: null,
  activeChildId: null,
  currentStudentProfileId: null,
  isEditingRoutine: false,
  selectedFile: null,
  selectedGalleryFile: null,
  isSaving: false,
  selectedAchievementType: 'Cordial',
  selectedActivityType: 'Classe',
  selectedActivityDone: true,
  activityMode: 'student',
  galleryPhotoMode: 'turma',
  authSession: null,
  authUser: null,
  currentTeacherProfile: null,
  currentParentProfile: null,
  galleryRealtimeChannel: null,
  activeParentGalleryTab: 'individual',
  activeParentPanelTab: 'perfil',
  parentChildSearchTimer: null,
  parentSignupChildMatch: null,
  parentOnboardingChildMatch: null,
  parentChildSearchCache: {},

  data: {
    students: [],
    professoras: [],
    turmas: [],
    galleryPhotos: [],
    parentClassmates: [],
    galleryInteractions: { likes: [], comments: [], saved: [] },
    routine: {
      'Segunda': '',
      'Terça': '',
      'Quarta': '',
      'Quinta': '',
      'Sexta': ''
    }
  },

  async init() {
    refreshIcons();

    const elDate = document.getElementById('attendance-date');
    if (elDate && !elDate.value) elDate.value = hojeISO();

    this.prepararFormularioLogin();

    try {
      const { data } = await supabaseClient.auth.getSession();
      if (data?.session) {
        this.authSession = data.session;
        this.authUser = data.session.user || null;

        try {
          await this.entrarAreaDocenteAutenticada({ silent: true });
          return;
        } catch (teacherErr) {
          console.warn('Sessão encontrada, mas não é de professora.', teacherErr);
        }

        try {
          await this.entrarAreaResponsavelAutenticada({ silent: true });
          return;
        } catch (parentErr) {
          console.warn('Sessão encontrada, mas não é de responsável vinculado.', parentErr);
        }

        await supabaseClient.auth.signOut().catch(() => {});
        this.authSession = null;
        this.authUser = null;
      }
    } catch (err) {
      console.warn('Sessão não restaurada.', err);
    }

    try {
      await this.carregarDadosPublicosIniciais();
    } catch (err) {
      console.warn('Dados iniciais públicos não carregados.', err);
    }

    this.resetNavigationState({ showLogin: true });
    refreshIcons();
  },

  prepararFormularioLogin() {
    ['login-email', 'login-password'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('keydown', event => {
          if (event.key === 'Enter') this.handleTeacherLogin(event);
        });
      }
    });

    ['parent-login-email', 'parent-login-password'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('keydown', event => {
          if (event.key === 'Enter') this.handleParentLogin(event);
        });
      }
    });

    ['parent-signup-name', 'parent-signup-child-name', 'parent-signup-email', 'parent-signup-password'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('keydown', event => {
          if (event.key === 'Enter') this.handleParentSignup(event);
        });
      }
    });

    const parentSignupChildInput = document.getElementById('parent-signup-child-name');
    if (parentSignupChildInput) {
      parentSignupChildInput.addEventListener('input', () => this.handleParentChildNameInput('signup'));
      parentSignupChildInput.addEventListener('blur', () => this.handleParentChildNameInput('signup', { immediate: true }));
    }

    this.showLoginPanel('teacher');
    this.showParentAuthMode('login');
  },

  showLoginPanel(tipo = 'teacher') {
    const isParent = tipo === 'parent';

    const teacherPanel = document.getElementById('login-panel-teacher');
    const parentPanel = document.getElementById('login-panel-parent');
    const teacherTab = document.getElementById('login-tab-teacher');
    const parentTab = document.getElementById('login-tab-parent');

    if (teacherPanel) teacherPanel.classList.toggle('hidden', isParent);
    if (parentPanel) parentPanel.classList.toggle('hidden', !isParent);
    if (teacherTab) teacherTab.classList.toggle('is-active', !isParent);
    if (parentTab) parentTab.classList.toggle('is-active', isParent);

    refreshIcons();
  },

  showParentAuthMode(mode = 'login') {
    const isSignup = mode === 'signup';

    const loginForm = document.getElementById('parent-login-form');
    const signupForm = document.getElementById('parent-signup-form');
    const loginTab = document.getElementById('parent-auth-login-tab');
    const signupTab = document.getElementById('parent-auth-signup-tab');

    if (loginForm) loginForm.classList.toggle('hidden', isSignup);
    if (signupForm) signupForm.classList.toggle('hidden', !isSignup);
    if (loginTab) loginTab.classList.toggle('is-active', !isSignup);
    if (signupTab) signupTab.classList.toggle('is-active', isSignup);

    const loginError = document.getElementById('login-parent-error');
    const signupMessage = document.getElementById('signup-parent-message');
    if (loginError) {
      loginError.classList.add('hidden');
      loginError.innerText = '';
    }
    if (signupMessage) {
      signupMessage.classList.add('hidden');
      signupMessage.innerText = '';
    }

    refreshIcons();
  },


  getParentChildInputConfig(context = 'signup') {
    if (context === 'onboarding') {
      return {
        inputId: 'parent-child-full-name',
        previewId: 'parent-child-name-preview',
        selectedKey: 'parentOnboardingChildMatch'
      };
    }

    return {
      inputId: 'parent-signup-child-name',
      previewId: 'parent-signup-child-preview',
      selectedKey: 'parentSignupChildMatch'
    };
  },

  async handleParentChildNameInput(context = 'signup', { immediate = false } = {}) {
    const config = this.getParentChildInputConfig(context);
    const input = document.getElementById(config.inputId);
    const nome = normalizarTexto(input?.value);

    this[config.selectedKey] = null;

    if (this.parentChildSearchTimer) {
      clearTimeout(this.parentChildSearchTimer);
      this.parentChildSearchTimer = null;
    }

    const executar = async () => {
      await this.renderParentChildNamePreview(context).catch(err => {
        const preview = document.getElementById(config.previewId);
        if (preview) {
          preview.innerHTML = `<div class="parent-child-match-empty"><i data-lucide="wifi-off" class="w-4 h-4"></i><span>Não foi possível consultar a base agora.</span></div>`;
          refreshIcons();
        }
        console.warn('Prévia do filho não carregada.', err);
      });
    };

    if (!nome || nome.length < 3) {
      const preview = document.getElementById(config.previewId);
      if (preview) preview.innerHTML = '';
      return;
    }

    if (immediate) await executar();
    else this.parentChildSearchTimer = setTimeout(executar, 260);
  },

  async buscarSugestoesFilhoPorNome(nome, { limit = 4 } = {}) {
    const texto = normalizarTexto(nome);
    if (!texto || texto.length < 3) return [];

    const cacheKey = normalizarNomeBusca(texto);
    const cache = this.parentChildSearchCache || {};
    if (Array.isArray(cache[cacheKey])) return cache[cacheKey].slice(0, limit);

    const alunos = await fetchDiretoDaAPI(
      'alunos',
      'id,nome_aluno,idade,data_nascimento,foto_url,turma_id,professora_id',
      'order=nome_aluno.asc'
    );

    const sugestoes = Array.isArray(alunos)
      ? alunos.map(aluno => {
          const score = calcularScoreNomeAluno(texto, aluno.nome_aluno || '');
          const exact = normalizarNomeBusca(texto) === normalizarNomeBusca(aluno.nome_aluno || '');
          return {
            id: aluno.id,
            name: aluno.nome_aluno || 'Aluno sem nome',
            age: calcularIdadePorNascimento(aluno.data_nascimento ? String(aluno.data_nascimento).substring(0, 10) : '') ?? aluno.idade ?? '',
            birthDate: aluno.data_nascimento ? String(aluno.data_nascimento).substring(0, 10) : '',
            photo: safeUrl(aluno.foto_url) || criarAvatarPadrao(aluno.nome_aluno || 'aluno'),
            turma_id: aluno.turma_id || '',
            professora_id: aluno.professora_id || '',
            turma_nome: this.getNomeTurma(aluno.turma_id || ''),
            professora_nome: this.getNomeProfessora(aluno.professora_id || ''),
            score,
            exact,
            confidence: classificarConfiancaNomeAluno(score, exact)
          };
        })
        .filter(item => item.score >= 0.56)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'pt'))
      : [];

    this.parentChildSearchCache = {
      ...cache,
      [cacheKey]: sugestoes
    };

    return sugestoes.slice(0, limit);
  },

  renderParentChildSuggestionCard(context, match, index = 0) {
    const percentual = Math.round((match.score || 0) * 100);
    const confiancaTexto = match.confidence === 'exata'
      ? 'Correspondência exata'
      : match.confidence === 'alta'
        ? 'Sugestão muito provável'
        : match.confidence === 'media'
          ? 'Confira com atenção'
          : 'Possível coincidência';

    return `
      <button type="button" onclick="window.app.confirmParentChildMatch('${escapeAttr(context)}', '${escapeAttr(match.id)}')" class="parent-child-match-card ${index === 0 ? 'is-best' : ''}">
        <img src="${escapeAttr(match.photo)}" alt="${escapeAttr(match.name)}">
        <span class="parent-child-match-info">
          <strong>${escapeHTML(match.name)}</strong>
          <small>${escapeHTML(formatarIdadeCalculada(Number.isInteger(Number(match.age)) ? Number(match.age) : null))}${match.turma_nome ? ` • ${escapeHTML(match.turma_nome)}` : ''}</small>
          <em>${escapeHTML(confiancaTexto)} • ${percentual}%</em>
        </span>
        <span class="parent-child-match-action">
          <i data-lucide="check" class="w-4 h-4"></i>
          Confirmar
        </span>
      </button>
    `;
  },

  async renderParentChildNamePreview(context = 'signup') {
    const config = this.getParentChildInputConfig(context);
    const input = document.getElementById(config.inputId);
    const preview = document.getElementById(config.previewId);
    const nome = normalizarTexto(input?.value);

    if (!preview) return;

    if (!nome || nome.length < 3) {
      preview.innerHTML = '';
      return;
    }

    preview.innerHTML = `<div class="parent-child-match-loading"><i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>A procurar ficha do aluno...</span></div>`;
    refreshIcons();

    const matches = await this.buscarSugestoesFilhoPorNome(nome);
    if (!matches.length) {
      preview.innerHTML = `
        <div class="parent-child-match-empty">
          <i data-lucide="search-x" class="w-4 h-4"></i>
          <span>Não encontrei uma ficha parecida. Confira nome e sobrenome ou peça um código à escola.</span>
        </div>
      `;
      refreshIcons();
      return;
    }

    const best = matches[0];
    const second = matches[1];
    const precisaConfirmar = !best.exact || (second && Math.abs((best.score || 0) - (second.score || 0)) < 0.12);

    preview.innerHTML = `
      <div class="parent-child-match-preview">
        <div class="parent-child-match-title">
          <span><i data-lucide="sparkles" class="w-4 h-4"></i> ${precisaConfirmar ? 'Sugestões encontradas' : 'Ficha encontrada'}</span>
          <small>${precisaConfirmar ? 'Confirme antes de continuar' : 'Confirme para vincular com segurança'}</small>
        </div>
        <div class="parent-child-match-list">
          ${matches.map((match, index) => this.renderParentChildSuggestionCard(context, match, index)).join('')}
        </div>
      </div>
    `;
    refreshIcons();
  },

  async confirmParentChildMatch(context = 'signup', alunoId = '') {
    const config = this.getParentChildInputConfig(context);
    const input = document.getElementById(config.inputId);
    const preview = document.getElementById(config.previewId);

    const todasSugestoes = Object.values(this.parentChildSearchCache || {}).flat();
    let match = todasSugestoes.find(item => String(item.id) === String(alunoId));

    if (!match && alunoId) {
      const alunos = await fetchDiretoDaAPI(
        'alunos',
        'id,nome_aluno,idade,data_nascimento,foto_url,turma_id,professora_id',
        `id=eq.${encodeURIComponent(alunoId)}&limit=1`
      );
      const aluno = Array.isArray(alunos) && alunos.length ? alunos[0] : null;
      if (aluno) {
        match = {
          id: aluno.id,
          name: aluno.nome_aluno || 'Aluno sem nome',
          age: calcularIdadePorNascimento(aluno.data_nascimento ? String(aluno.data_nascimento).substring(0, 10) : '') ?? aluno.idade ?? '',
          birthDate: aluno.data_nascimento ? String(aluno.data_nascimento).substring(0, 10) : '',
          photo: safeUrl(aluno.foto_url) || criarAvatarPadrao(aluno.nome_aluno || 'aluno'),
          turma_id: aluno.turma_id || '',
          professora_id: aluno.professora_id || '',
          turma_nome: this.getNomeTurma(aluno.turma_id || ''),
          professora_nome: this.getNomeProfessora(aluno.professora_id || ''),
          score: 1,
          exact: true,
          confidence: 'exata'
        };
      }
    }

    if (!match) {
      alert('Não consegui confirmar esta ficha. Digite o nome novamente ou peça um código à escola.');
      return;
    }

    this[config.selectedKey] = match;
    if (input) input.value = match.name;

    if (preview) {
      preview.innerHTML = `
        <div class="parent-child-match-selected">
          <img src="${escapeAttr(match.photo)}" alt="${escapeAttr(match.name)}">
          <div>
            <strong>${escapeHTML(match.name)}</strong>
            <small>${escapeHTML(match.turma_nome || 'Turma não informada')}${match.professora_nome ? ` • ${escapeHTML(match.professora_nome)}` : ''}</small>
          </div>
          <span><i data-lucide="badge-check" class="w-4 h-4"></i> Filho confirmado</span>
        </div>
      `;
      refreshIcons();
    }
  },

  async resolverFilhoConfirmadoParaCadastro(nomeFilho, context = 'signup') {
    const config = this.getParentChildInputConfig(context);
    const confirmado = this[config.selectedKey];

    if (confirmado?.id && normalizarNomeBusca(confirmado.name) === normalizarNomeBusca(nomeFilho)) {
      return confirmado;
    }

    const sugestoes = await this.buscarSugestoesFilhoPorNome(nomeFilho, { limit: 3 });
    const melhor = sugestoes[0];
    const segundo = sugestoes[1];

    if (!melhor) {
      throw new Error('Não encontramos a ficha do aluno. Confira o nome completo ou solicite um código à escola.');
    }

    const matchExato = melhor.exact === true;
    const matchMuitoSeguro = melhor.score >= 0.94 && (!segundo || (melhor.score - segundo.score) >= 0.16);

    if (matchExato || matchMuitoSeguro) {
      return melhor;
    }

    await this.renderParentChildNamePreview(context);
    throw new Error('Confirme a prévia com foto do aluno antes de continuar. Isso evita vínculo com a criança errada.');
  },

  async linkParentByStudentIdInternal(alunoId, { nomeFilho = '', matchScore = 1 } = {}) {
    const responsavel = this.currentParentProfile;
    if (!responsavel?.id) {
      throw new Error('Perfil do responsável não encontrado.');
    }

    if (!alunoId) {
      throw new Error('Ficha do aluno não informada.');
    }

    // O primeiro filho informado no cadastro só é usado antes de existir vínculo.
    // Depois disso, novos filhos entram por código da escola.
    if (responsavel.aluno_ids?.length) {
      return responsavel.links?.find(link => String(link.aluno_id) === String(alunoId)) || responsavel.links?.[0] || null;
    }

    const alunos = await fetchDiretoDaAPI(
      'alunos',
      'id,nome_aluno,turma_id,professora_id',
      `id=eq.${encodeURIComponent(alunoId)}&limit=1`
    );

    const aluno = Array.isArray(alunos) && alunos.length ? alunos[0] : null;
    if (!aluno) {
      throw new Error('Ficha do aluno não encontrada.');
    }

    const vinculosExistentes = await fetchDiretoDaAPI(
      'responsavel_alunos',
      'id,responsavel_id,aluno_id,ativo',
      `responsavel_id=eq.${encodeURIComponent(responsavel.id)}&aluno_id=eq.${encodeURIComponent(aluno.id)}&limit=1`
    ).catch(() => []);

    let linkFinal = null;
    if (Array.isArray(vinculosExistentes) && vinculosExistentes.length > 0) {
      const link = vinculosExistentes[0];
      if (link.ativo === false) {
        await mutateDiretoDaAPI(
          'responsavel_alunos',
          'PATCH',
          { ativo: true, status_vinculo: 'ativo' },
          `id=eq.${encodeURIComponent(link.id)}`
        );
      }
      linkFinal = link;
    } else {
      const criado = await mutateDiretoDaAPI('responsavel_alunos', 'POST', {
        responsavel_id: responsavel.id,
        aluno_id: aluno.id,
        parentesco: responsavel.parentesco_padrao || null,
        ativo: true,
        status_vinculo: 'ativo',
        ficha_revisada: false,
        ficha_revisao_origem: 'vinculo_por_previa'
      });
      linkFinal = Array.isArray(criado) && criado.length ? criado[0] : null;
    }

    await mutateDiretoDaAPI(
      'responsaveis',
      'PATCH',
      {
        aluno_nome_informado: nomeFilho || aluno.nome_aluno || responsavel.aluno_nome_informado || null,
        aluno_id_informado: aluno.id,
        aluno_match_score: matchScore,
        aluno_match_confirmado: true,
        aluno_nome_informado_bloqueado: true,
        primeiro_filho_vinculado_em: responsavel.primeiro_filho_vinculado_em || new Date().toISOString(),
        onboarding_concluido: true
      },
      `id=eq.${encodeURIComponent(responsavel.id)}`
    ).catch(() => {});

    return linkFinal;
  },

  async completeParentFirstStep() {
    if (this.isSaving) return;

    const responsavel = this.currentParentProfile;
    if (!responsavel?.id) {
      alert('Perfil do responsável não encontrado.');
      return;
    }

    const nome = normalizarTexto(document.getElementById('parent-onboarding-name')?.value);
    const telefone = normalizarTexto(document.getElementById('parent-onboarding-phone')?.value);
    const parentesco = normalizarTexto(document.getElementById('parent-onboarding-parentesco')?.value);
    const nomeFilho = normalizarTexto(document.getElementById('parent-child-full-name')?.value) || responsavel.aluno_nome_informado || '';

    if (!nome) {
      alert('Informe seu nome completo para avançar.');
      return;
    }

    if (!nomeFilho || !contemNomeESobrenome(nomeFilho)) {
      alert('Informe nome e sobrenome do filho para localizar a ficha correta.');
      return;
    }

    this.isSaving = true;
    try {
      const match = await this.resolverFilhoConfirmadoParaCadastro(nomeFilho, 'onboarding');

      await mutateDiretoDaAPI(
        'responsaveis',
        'PATCH',
        {
          nome,
          telefone: telefone || null,
          parentesco_padrao: parentesco || null,
          aluno_nome_informado: match.name || nomeFilho,
          aluno_id_informado: match.id,
          aluno_match_score: match.score || null,
          aluno_match_confirmado: true,
          cadastro_completo_em: new Date().toISOString()
        },
        `id=eq.${encodeURIComponent(responsavel.id)}`
      );

      await this.carregarPerfilResponsavel();
      await this.linkParentByStudentIdInternal(match.id, { nomeFilho: match.name || nomeFilho, matchScore: match.score || 1 });
      await this.carregarPerfilResponsavel();
      await this.fetchStudents({ silent: true });
      await this.fetchParentClassmates({ silent: true });
      await this.fetchGalleryPhotos({ silent: true });
      this.activeChildId = match.id || this.data.students[0]?.id || null;
      this.renderParentView();
    } catch (err) {
      mostrarErro(err, 'Primeiro passo do responsável');
    } finally {
      this.isSaving = false;
    }
  },

  async carregarDadosPublicosIniciais() {
    await this.fetchSchoolContext({ silent: true });
    await Promise.all([
      this.fetchRoutine({ silent: true }),
      this.fetchStudents({ silent: true })
    ]);
  },

  async recarregarDados() {
    await this.fetchSchoolContext();
    await Promise.all([
      this.fetchRoutine(),
      this.fetchStudents()
    ]);
  },

  async handleTeacherLogin(event = null) {
    if (event?.preventDefault) event.preventDefault();
    if (this.isSaving) return;

    const email = normalizarTexto(document.getElementById('login-email')?.value);
    const password = String(document.getElementById('login-password')?.value || '');
    const errorBox = document.getElementById('login-teacher-error');
    const btn = document.getElementById('btn-login-teacher');

    if (errorBox) {
      errorBox.classList.add('hidden');
      errorBox.innerText = '';
    }

    if (!email || !password) {
      if (errorBox) {
        errorBox.innerText = 'Informe o email e a senha da professora.';
        errorBox.classList.remove('hidden');
      } else {
        alert('Informe o email e a senha da professora.');
      }
      return;
    }

    this.isSaving = true;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> A entrar...';
      refreshIcons();
    }

    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;

      this.authSession = data.session || null;
      this.authUser = data.user || data.session?.user || null;

      await this.entrarAreaDocenteAutenticada();

      const passwordInput = document.getElementById('login-password');
      if (passwordInput) passwordInput.value = '';
    } catch (error) {
      console.error('Login docente', error);
      if (errorBox) {
        errorBox.innerText = error?.message || 'Não foi possível entrar. Verifique o email e a senha.';
        errorBox.classList.remove('hidden');
      } else {
        mostrarErro(error, 'Login da professora');
      }
    } finally {
      this.isSaving = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="log-in" class="w-5 h-5"></i> Entrar como professora';
        refreshIcons();
      }
    }
  },


  async handleParentLogin(event = null) {
    if (event?.preventDefault) event.preventDefault();
    if (this.isSaving) return;

    const email = normalizarTexto(document.getElementById('parent-login-email')?.value);
    const password = String(document.getElementById('parent-login-password')?.value || '');
    const errorBox = document.getElementById('login-parent-error');
    const btn = document.getElementById('btn-login-parent');

    if (errorBox) {
      errorBox.classList.add('hidden');
      errorBox.innerText = '';
    }

    if (!email || !password) {
      if (errorBox) {
        errorBox.innerText = 'Informe o email e a senha do responsável.';
        errorBox.classList.remove('hidden');
      } else {
        alert('Informe o email e a senha do responsável.');
      }
      return;
    }

    this.isSaving = true;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> A entrar...';
      refreshIcons();
    }

    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;

      this.authSession = data.session || null;
      this.authUser = data.user || data.session?.user || null;

      await this.entrarAreaResponsavelAutenticada();

      const passwordInput = document.getElementById('parent-login-password');
      if (passwordInput) passwordInput.value = '';
    } catch (error) {
      console.error('Login responsável', error);
      if (errorBox) {
        errorBox.innerText = error?.message || 'Não foi possível entrar. Verifique o email, a senha e o vínculo com o aluno.';
        errorBox.classList.remove('hidden');
      } else {
        mostrarErro(error, 'Login do responsável');
      }
    } finally {
      this.isSaving = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="log-in" class="w-5 h-5"></i> Entrar como responsável';
        refreshIcons();
      }
    }
  },



  async handleParentSignup(event = null) {
    if (event?.preventDefault) event.preventDefault();
    if (this.isSaving) return;

    const nome = normalizarTexto(document.getElementById('parent-signup-name')?.value);
    const nomeFilho = normalizarTexto(document.getElementById('parent-signup-child-name')?.value);
    const email = normalizarTexto(document.getElementById('parent-signup-email')?.value);
    const password = String(document.getElementById('parent-signup-password')?.value || '');
    const messageBox = document.getElementById('signup-parent-message');
    const btn = document.getElementById('btn-signup-parent');

    if (messageBox) {
      messageBox.className = 'hidden rounded-2xl border px-4 py-3 text-sm font-semibold';
      messageBox.innerText = '';
    }

    if (!nome || !nomeFilho || !email || !password) {
      if (messageBox) {
        messageBox.className = 'rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700';
        messageBox.innerText = 'Informe seu nome, o nome completo do filho, email e senha para criar o acesso.';
      } else {
        alert('Informe seu nome, o nome completo do filho, email e senha para criar o acesso.');
      }
      return;
    }

    if (!contemNomeESobrenome(nomeFilho)) {
      if (messageBox) {
        messageBox.className = 'rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700';
        messageBox.innerText = 'Informe nome e sobrenome do filho para localizar a ficha correta.';
      } else {
        alert('Informe nome e sobrenome do filho.');
      }
      return;
    }

    if (password.length < 6) {
      if (messageBox) {
        messageBox.className = 'rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700';
        messageBox.innerText = 'Use uma senha com pelo menos 6 caracteres.';
      } else {
        alert('Use uma senha com pelo menos 6 caracteres.');
      }
      return;
    }

    let filhoConfirmado = null;
    try {
      filhoConfirmado = await this.resolverFilhoConfirmadoParaCadastro(nomeFilho, 'signup');
    } catch (err) {
      if (messageBox) {
        messageBox.className = 'rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700';
        messageBox.innerText = err?.message || 'Confirme a ficha do filho antes de criar o acesso.';
      } else {
        alert(err?.message || 'Confirme a ficha do filho antes de criar o acesso.');
      }
      return;
    }

    const btnOriginal = btn ? btn.innerHTML : '';
    this.isSaving = true;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> A criar acesso...';
      refreshIcons();
    }

    try {
      const redirectTo = window.location.origin + window.location.pathname;
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: { nome, tipo: 'responsavel', filho_nome: filhoConfirmado?.name || nomeFilho, filho_id: filhoConfirmado?.id || '' }
        }
      });
      if (error) throw error;

      const user = data?.user || data?.session?.user || null;
      if (data?.session) {
        this.authSession = data.session;
        this.authUser = user;
        await this.criarOuAtualizarResponsavelDoUsuario({ nome, email, filhoNome: filhoConfirmado?.name || nomeFilho, filhoId: filhoConfirmado?.id || '', matchScore: filhoConfirmado?.score || null, provider: 'email' });
        await this.entrarAreaResponsavelAutenticada({ silent: true });
      } else {
        await this.criarResponsavelPendentePorEmail({ nome, email, filhoNome: filhoConfirmado?.name || nomeFilho, filhoId: filhoConfirmado?.id || '', matchScore: filhoConfirmado?.score || null });
        if (messageBox) {
          messageBox.className = 'rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700';
          messageBox.innerText = 'Cadastro criado. Verifique seu email para confirmar o acesso e depois entre com sua senha.';
        } else {
          alert('Cadastro criado. Verifique seu email para confirmar o acesso e depois entre com sua senha.');
        }
        this.showParentAuthMode('login');
        const loginEmail = document.getElementById('parent-login-email');
        if (loginEmail) loginEmail.value = email;
      }
    } catch (error) {
      console.error('Cadastro responsável', error);
      if (messageBox) {
        messageBox.className = 'rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700';
        messageBox.innerText = error?.message || 'Não foi possível criar o acesso agora.';
      } else {
        mostrarErro(error, 'Cadastro do responsável');
      }
    } finally {
      this.isSaving = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = btnOriginal || '<i data-lucide="mail-check" class="w-5 h-5"></i> Criar acesso e verificar email';
        refreshIcons();
      }
    }
  },

  async handleParentGoogleLogin() {
    if (this.isSaving) return;

    try {
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + window.location.pathname,
          queryParams: {
            access_type: 'offline',
            prompt: 'select_account'
          }
        }
      });
      if (error) throw error;
    } catch (error) {
      mostrarErro(error, 'Login com Google');
    }
  },

  async criarResponsavelPendentePorEmail({ nome, email, filhoNome = '', filhoId = '', matchScore = null }) {
    if (!email) return null;
    try {
      const existentes = await fetchDiretoDaAPI(
        'responsaveis',
        'id,nome,email,telefone,auth_user_id,ativo,aluno_nome_informado,aluno_id_informado,aluno_match_score,aluno_match_confirmado',
        `email=eq.${encodeURIComponent(email)}&limit=1`
      );
      if (Array.isArray(existentes) && existentes.length > 0) {
        const existente = existentes[0];
        if ((filhoNome && !existente.aluno_nome_informado) || (filhoId && !existente.aluno_id_informado)) {
          const atualizado = await mutateDiretoDaAPI(
            'responsaveis',
            'PATCH',
            {
              aluno_nome_informado: filhoNome || existente.aluno_nome_informado || null,
              aluno_id_informado: filhoId || existente.aluno_id_informado || null,
              aluno_match_score: matchScore,
              aluno_match_confirmado: !!(filhoId || existente.aluno_id_informado)
            },
            `id=eq.${encodeURIComponent(existente.id)}`
          );
          return Array.isArray(atualizado) && atualizado.length ? atualizado[0] : { ...existente, aluno_nome_informado: filhoNome, aluno_id_informado: filhoId };
        }
        return existente;
      }

      const criado = await mutateDiretoDaAPI('responsaveis', 'POST', {
        nome: nome || email,
        email,
        aluno_nome_informado: filhoNome || null,
        aluno_id_informado: filhoId || null,
        aluno_match_score: matchScore,
        aluno_match_confirmado: !!filhoId,
        ativo: true,
        provider: 'email',
        onboarding_concluido: false,
        tutorial_concluido: false
      });

      return Array.isArray(criado) && criado.length ? criado[0] : null;
    } catch (err) {
      console.warn('Não foi possível criar responsável pendente por email.', err);
      return null;
    }
  },

  async criarOuAtualizarResponsavelDoUsuario({ nome = '', email = '', telefone = '', parentesco = '', filhoNome = '', filhoId = '', matchScore = null, provider = '' } = {}) {
    const user = this.authUser;
    if (!user?.id) return null;

    const emailFinal = email || user.email || '';
    const nomeFinal =
      nome ||
      user.user_metadata?.nome ||
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      emailFinal ||
      'Responsável';

    let perfis = await fetchDiretoDaAPI(
      'responsaveis',
      'id,nome,email,telefone,auth_user_id,ativo,avatar_url,parentesco_padrao,onboarding_concluido,cadastro_completo_em,provider,aluno_nome_informado,aluno_id_informado,aluno_match_score,aluno_match_confirmado,aluno_nome_informado_bloqueado,primeiro_filho_vinculado_em,tutorial_concluido,tutorial_concluido_em',
      `auth_user_id=eq.${encodeURIComponent(user.id)}&limit=1`
    );

    if ((!Array.isArray(perfis) || perfis.length === 0) && emailFinal) {
      perfis = await fetchDiretoDaAPI(
        'responsaveis',
        'id,nome,email,telefone,auth_user_id,ativo,avatar_url,parentesco_padrao,onboarding_concluido,cadastro_completo_em,provider,aluno_nome_informado,aluno_id_informado,aluno_match_score,aluno_match_confirmado,aluno_nome_informado_bloqueado,primeiro_filho_vinculado_em,tutorial_concluido,tutorial_concluido_em',
        `email=eq.${encodeURIComponent(emailFinal)}&limit=1`
      );
    }

    if (Array.isArray(perfis) && perfis.length > 0) {
      const perfil = perfis[0];
      const atualizado = await mutateDiretoDaAPI(
        'responsaveis',
        'PATCH',
        {
          auth_user_id: user.id,
          nome: nomeFinal || perfil.nome,
          email: emailFinal || perfil.email,
          telefone: telefone || perfil.telefone || null,
          parentesco_padrao: parentesco || perfil.parentesco_padrao || null,
          aluno_nome_informado: filhoNome || perfil.aluno_nome_informado || user.user_metadata?.filho_nome || null,
          aluno_id_informado: filhoId || perfil.aluno_id_informado || user.user_metadata?.filho_id || null,
          aluno_match_score: matchScore ?? perfil.aluno_match_score ?? null,
          aluno_match_confirmado: !!(filhoId || perfil.aluno_id_informado || user.user_metadata?.filho_id),
          provider: provider || perfil.provider || user.app_metadata?.provider || null,
          ativo: true,
          ultimo_acesso_em: new Date().toISOString()
        },
        `id=eq.${encodeURIComponent(perfil.id)}`
      );
      return Array.isArray(atualizado) && atualizado.length ? atualizado[0] : { ...perfil, auth_user_id: user.id };
    }

    const criado = await mutateDiretoDaAPI('responsaveis', 'POST', {
      auth_user_id: user.id,
      nome: nomeFinal,
      email: emailFinal || null,
      telefone: telefone || null,
      parentesco_padrao: parentesco || null,
      aluno_nome_informado: filhoNome || user.user_metadata?.filho_nome || null,
      aluno_id_informado: filhoId || user.user_metadata?.filho_id || null,
      aluno_match_score: matchScore,
      aluno_match_confirmado: !!(filhoId || user.user_metadata?.filho_id),
      provider: provider || user.app_metadata?.provider || 'email',
      ativo: true,
      onboarding_concluido: false,
      tutorial_concluido: false,
      ultimo_acesso_em: new Date().toISOString()
    });

    return Array.isArray(criado) && criado.length ? criado[0] : null;
  },
  async entrarAreaResponsavelAutenticada({ silent = false } = {}) {
    if (!this.authUser) {
      const { data } = await supabaseClient.auth.getSession();
      this.authSession = data?.session || null;
      this.authUser = data?.session?.user || null;
    }

    if (!this.authUser) {
      throw new Error('Sessão do responsável não encontrada.');
    }

    await this.carregarPerfilResponsavel();
    await this.fetchSchoolContext({ silent });

    if ((!this.currentParentProfile?.aluno_ids || this.currentParentProfile.aluno_ids.length === 0) && this.currentParentProfile?.aluno_id_informado) {
      await this.linkParentByStudentIdInternal(this.currentParentProfile.aluno_id_informado, {
        nomeFilho: this.currentParentProfile.aluno_nome_informado,
        matchScore: this.currentParentProfile.aluno_match_score || 1
      }).catch(err => {
        if (!silent) console.warn('Vínculo automático por ficha confirmada não concluído.', err);
      });
      await this.carregarPerfilResponsavel();
    } else if ((!this.currentParentProfile?.aluno_ids || this.currentParentProfile.aluno_ids.length === 0) && this.currentParentProfile?.aluno_nome_informado) {
      await this.linkParentByStudentNameInternal(this.currentParentProfile.aluno_nome_informado, { silent: true }).catch(err => {
        if (!silent) console.warn('Vínculo automático por nome não concluído.', err);
      });
      await this.carregarPerfilResponsavel();
    }

    await this.fetchStudents({ silent });
    await this.fetchParentClassmates({ silent: true });
    await this.fetchGalleryPhotos({ silent: true });
    this.startGalleryRealtime();
    const primeiroAluno = this.data.students[0];
    this.login('parent', primeiroAluno?.id || null);
  },

  async carregarPerfilResponsavel() {
    const user = this.authUser;
    if (!user?.id) {
      this.currentParentProfile = null;
      return null;
    }

    let perfis = await fetchDiretoDaAPI(
      'responsaveis',
      'id,nome,email,telefone,auth_user_id,ativo,avatar_url,parentesco_padrao,onboarding_concluido,cadastro_completo_em,provider,aluno_nome_informado,aluno_id_informado,aluno_match_score,aluno_match_confirmado,aluno_nome_informado_bloqueado,primeiro_filho_vinculado_em,tutorial_concluido,tutorial_concluido_em',
      `auth_user_id=eq.${encodeURIComponent(user.id)}&ativo=eq.true&limit=1`
    );

    if ((!Array.isArray(perfis) || perfis.length === 0) && user.email) {
      const porEmail = await fetchDiretoDaAPI(
        'responsaveis',
        'id,nome,email,telefone,auth_user_id,ativo,avatar_url,parentesco_padrao,onboarding_concluido,cadastro_completo_em,provider,aluno_nome_informado,aluno_id_informado,aluno_match_score,aluno_match_confirmado,aluno_nome_informado_bloqueado,primeiro_filho_vinculado_em,tutorial_concluido,tutorial_concluido_em',
        `email=eq.${encodeURIComponent(user.email)}&ativo=eq.true&limit=1`
      );

      if (Array.isArray(porEmail) && porEmail.length > 0) {
        const perfil = porEmail[0];
        if (!perfil.auth_user_id) {
          const atualizado = await mutateDiretoDaAPI(
            'responsaveis',
            'PATCH',
            {
              auth_user_id: user.id,
              nome: perfil.nome || user.user_metadata?.nome || user.user_metadata?.full_name || user.email,
              provider: perfil.provider || user.app_metadata?.provider || 'email',
              ultimo_acesso_em: new Date().toISOString()
            },
            `id=eq.${encodeURIComponent(perfil.id)}`
          );
          perfis = Array.isArray(atualizado) && atualizado.length ? atualizado : [{ ...perfil, auth_user_id: user.id }];
        } else {
          perfis = porEmail;
        }
      }
    }

    if (!Array.isArray(perfis) || perfis.length === 0) {
      const criado = await this.criarOuAtualizarResponsavelDoUsuario({
        provider: user.app_metadata?.provider || 'email'
      });
      perfis = criado ? [criado] : [];
    }

    if (!Array.isArray(perfis) || perfis.length === 0) {
      throw new Error('Login válido, mas não foi possível criar ou carregar o perfil do responsável.');
    }

    const perfil = perfis[0];
    let vinculos = [];
    try {
      vinculos = await fetchDiretoDaAPI(
        'responsavel_alunos',
        'id,responsavel_id,aluno_id,parentesco,ativo,status_vinculo,ficha_revisada,ficha_revisada_em,ficha_revisada_por,convite_id',
        `responsavel_id=eq.${encodeURIComponent(perfil.id)}&ativo=eq.true`
      );
    } catch (err) {
      console.warn('Vínculos do responsável não carregados.', err);
      vinculos = [];
    }

    const links = Array.isArray(vinculos) ? vinculos : [];
    const alunoIds = links.map(v => v.aluno_id).filter(Boolean);

    this.currentParentProfile = {
      id: perfil.id,
      nome: perfil.nome || user.user_metadata?.nome || user.user_metadata?.full_name || user.email || 'Responsável',
      email: perfil.email || user.email || '',
      telefone: perfil.telefone || '',
      auth_user_id: perfil.auth_user_id || user.id,
      avatar_url: safeUrl(perfil.avatar_url) || '',
      parentesco_padrao: perfil.parentesco_padrao || '',
      aluno_nome_informado: perfil.aluno_nome_informado || user.user_metadata?.filho_nome || '',
      aluno_id_informado: perfil.aluno_id_informado || user.user_metadata?.filho_id || '',
      aluno_match_score: perfil.aluno_match_score || null,
      aluno_match_confirmado: perfil.aluno_match_confirmado === true,
      aluno_nome_informado_bloqueado: perfil.aluno_nome_informado_bloqueado === true,
      primeiro_filho_vinculado_em: perfil.primeiro_filho_vinculado_em || '',
      onboarding_concluido: perfil.onboarding_concluido === true,
      cadastro_completo_em: perfil.cadastro_completo_em || '',
      tutorial_concluido: perfil.tutorial_concluido === true,
      tutorial_concluido_em: perfil.tutorial_concluido_em || '',
      provider: perfil.provider || user.app_metadata?.provider || '',
      links,
      aluno_ids: alunoIds
    };

    return this.currentParentProfile;
  },

  async entrarAreaDocenteAutenticada({ silent = false } = {}) {
    if (!this.authUser) {
      const { data } = await supabaseClient.auth.getSession();
      this.authSession = data?.session || null;
      this.authUser = data?.session?.user || null;
    }

    if (!this.authUser) {
      throw new Error('Sessão da professora não encontrada.');
    }

    await this.carregarPerfilDocente();
    this.currentParentProfile = null;
    this.stopGalleryRealtime();
    await this.recarregarDados();
    await this.fetchGalleryPhotos({ silent: true });
    this.login('teacher');
  },

  async carregarPerfilDocente() {
    const user = this.authUser;
    if (!user?.id) {
      this.currentTeacherProfile = null;
      return null;
    }

    let perfis = await fetchDiretoDaAPI(
      'professoras',
      'id,nome,email,telefone,auth_user_id,ativo',
      `auth_user_id=eq.${encodeURIComponent(user.id)}&ativo=eq.true&limit=1`
    );

    if ((!Array.isArray(perfis) || perfis.length === 0) && user.email) {
      const porEmail = await fetchDiretoDaAPI(
        'professoras',
        'id,nome,email,telefone,auth_user_id,ativo',
        `email=eq.${encodeURIComponent(user.email)}&ativo=eq.true&limit=1`
      );

      if (Array.isArray(porEmail) && porEmail.length > 0) {
        const perfil = porEmail[0];
        if (!perfil.auth_user_id) {
          const atualizado = await mutateDiretoDaAPI(
            'professoras',
            'PATCH',
            { auth_user_id: user.id },
            `id=eq.${encodeURIComponent(perfil.id)}`
          );
          perfis = Array.isArray(atualizado) && atualizado.length ? atualizado : [{ ...perfil, auth_user_id: user.id }];
        } else {
          perfis = porEmail;
        }
      }
    }

    if (!Array.isArray(perfis) || perfis.length === 0) {
      throw new Error('Login válido, mas nenhuma professora ativa foi vinculada a este usuário. Cadastre o email em gestao_escola.professoras ou preencha auth_user_id.');
    }

    this.currentTeacherProfile = {
      id: perfis[0].id,
      nome: perfis[0].nome || user.email || 'Professora',
      email: perfis[0].email || user.email || '',
      telefone: perfis[0].telefone || '',
      auth_user_id: perfis[0].auth_user_id || user.id
    };

    return this.currentTeacherProfile;
  },

  async fetchSchoolContext({ silent = false } = {}) {
    try {
      const [professoras, turmas] = await Promise.all([
        fetchDiretoDaAPI('professoras', 'id,nome,email,telefone,auth_user_id,ativo', 'ativo=eq.true&order=nome.asc'),
        fetchDiretoDaAPI('turmas', 'id,nome,ano_letivo,professora_id,ativo', 'ativo=eq.true&order=nome.asc')
      ]);

      this.data.professoras = Array.isArray(professoras)
        ? professoras.map(p => ({
            id: p.id,
            nome: p.nome || 'Professora sem nome',
            email: p.email || '',
            telefone: p.telefone || '',
            auth_user_id: p.auth_user_id || '',
            ativo: p.ativo !== false
          }))
        : [];

      this.data.turmas = Array.isArray(turmas)
        ? turmas.map(t => ({
            id: t.id,
            nome: t.nome || 'Turma sem nome',
            ano_letivo: t.ano_letivo || '',
            professora_id: t.professora_id || '',
            ativo: t.ativo !== false
          }))
        : [];

      if (this.currentTeacherProfile?.id && !this.data.professoras.some(p => String(p.id) === String(this.currentTeacherProfile.id))) {
        this.data.professoras.unshift(this.currentTeacherProfile);
      }

      this.atualizarIdentidadeDocenteUI();
      this.renderSchoolSelectors('new');
      this.renderSchoolSelectors('edit');
    } catch (err) {
      if (!silent) mostrarErro(err, 'Carregamento de professoras e turmas');
      throw err;
    }
  },

  getProfessorasDisponiveis() {
    if (this.currentTeacherProfile?.id) {
      return this.data.professoras.filter(p => String(p.id) === String(this.currentTeacherProfile.id));
    }
    return this.data.professoras;
  },

  getTurmasDisponiveis(professoraId = '') {
    const id = professoraId || this.currentTeacherProfile?.id || '';
    return this.data.turmas.filter(t => !id || !t.professora_id || String(t.professora_id) === String(id));
  },

  getNomeProfessora(professoraId) {
    if (!professoraId) return '';
    const nome = this.data.professoras.find(p => String(p.id) === String(professoraId))?.nome || '';
    return formatarNomeProfessora(nome);
  },

  getNomeTurma(turmaId) {
    if (!turmaId) return '';
    const turma = this.data.turmas.find(t => String(t.id) === String(turmaId));
    if (!turma) return '';
    return turma.ano_letivo ? `${turma.nome} · ${turma.ano_letivo}` : turma.nome;
  },

  renderSchoolSelectors(context = 'new', selectedProfessoraId = null, selectedTurmaId = null) {
    const isEdit = context === 'edit';
    const professoraSelect = document.getElementById(isEdit ? 'edit-professora' : 'input-new-professora');
    const turmaSelect = document.getElementById(isEdit ? 'edit-turma' : 'input-new-turma');

    if (!professoraSelect || !turmaSelect) return;

    const professoras = this.getProfessorasDisponiveis();
    const professoraPadrao = selectedProfessoraId ?? this.currentTeacherProfile?.id ?? professoraSelect.value ?? '';

    professoraSelect.innerHTML = [
      '<option value="">Selecione a professora</option>',
      ...professoras.map(p => `<option value="${escapeAttr(p.id)}">${escapeHTML(formatarNomeProfessora(p.nome))}${p.email ? ` · ${escapeHTML(p.email)}` : ''}</option>`)
    ].join('');

    professoraSelect.value = professoras.some(p => String(p.id) === String(professoraPadrao)) ? String(professoraPadrao) : '';

    if (this.currentTeacherProfile?.id) {
      professoraSelect.value = String(this.currentTeacherProfile.id);
      professoraSelect.disabled = true;
    } else {
      professoraSelect.disabled = false;
    }

    this.sincronizarSelectTurmasAluno(context, selectedTurmaId);
  },

  sincronizarSelectTurmasAluno(context = 'new', selectedTurmaId = null) {
    const isEdit = context === 'edit';
    const professoraSelect = document.getElementById(isEdit ? 'edit-professora' : 'input-new-professora');
    const turmaSelect = document.getElementById(isEdit ? 'edit-turma' : 'input-new-turma');

    if (!turmaSelect) return;

    const professoraId = professoraSelect?.value || this.currentTeacherProfile?.id || '';
    const valorAtual = selectedTurmaId ?? turmaSelect.value ?? '';
    const turmas = this.getTurmasDisponiveis(professoraId);

    turmaSelect.innerHTML = [
      '<option value="">Selecione a turma</option>',
      ...turmas.map(t => `<option value="${escapeAttr(t.id)}">${escapeHTML(t.nome)}${t.ano_letivo ? ` · ${escapeHTML(t.ano_letivo)}` : ''}</option>`)
    ].join('');

    if (turmas.some(t => String(t.id) === String(valorAtual))) {
      turmaSelect.value = String(valorAtual);
    } else if (this.currentTeacherProfile?.id && turmas.length === 1) {
      turmaSelect.value = String(turmas[0].id);
    } else {
      turmaSelect.value = '';
    }
  },

  atualizarIdadeCalculada(context = 'new') {
    const isEdit = context === 'edit';
    const input = document.getElementById(isEdit ? 'edit-data-nascimento' : 'input-new-data-nascimento');
    const display = document.getElementById(isEdit ? 'edit-idade-calculada' : 'input-new-idade-calculada');

    if (!display) return;

    const dataNascimento = input?.value || '';
    const idade = calcularIdadePorNascimento(dataNascimento);

    if (!dataNascimento) {
      display.innerText = 'Idade calculada automaticamente.';
      display.className = 'mt-1.5 text-xs font-semibold text-slate-400';
      return;
    }

    if (idade === null) {
      display.innerText = 'Data inválida ou futura.';
      display.className = 'mt-1.5 text-xs font-semibold text-red-600';
      return;
    }

    const aniversario = obterProximoAniversarioInfo(dataNascimento);
    display.innerText = aniversario?.hoje
      ? `${formatarIdadeCalculada(idade)} · aniversário hoje 🎂`
      : `${formatarIdadeCalculada(idade)} · ${aniversario?.label || 'aniversário calculado'}`;
    display.className = aniversario?.hoje
      ? 'mt-1.5 text-xs font-extrabold text-rose-600'
      : 'mt-1.5 text-xs font-semibold text-blue-600';
  },

  renderBirthdayAlerts() {
    const container = document.getElementById('birthday-alerts');
    if (!container) return;

    const proximos = (Array.isArray(this.data.students) ? this.data.students : [])
      .map(student => ({
        student,
        info: obterProximoAniversarioInfo(student.birthDate)
      }))
      .filter(item => item.info && item.info.dias <= 30)
      .sort((a, b) => a.info.dias - b.info.dias || String(a.student.name).localeCompare(String(b.student.name)));

    if (!proximos.length) {
      container.innerHTML = '';
      container.classList.add('hidden');
      return;
    }

    const hoje = proximos.filter(item => item.info.hoje);
    const proximosSemHoje = proximos.filter(item => !item.info.hoje).slice(0, 4);

    const itens = [...hoje, ...proximosSemHoje];

    container.innerHTML = `
      <section class="birthday-alert-panel ${hoje.length ? 'has-today' : ''}">
        <div class="birthday-alert-heading">
          <span class="birthday-alert-icon"><i data-lucide="${hoje.length ? 'party-popper' : 'cake'}" class="w-5 h-5"></i></span>
          <div>
            <p class="profile-eyebrow">${hoje.length ? 'Aniversário hoje' : 'Próximos aniversários'}</p>
            <h3>${hoje.length ? `${hoje.length} aluno(s) fazem aniversário hoje` : 'Acompanhe os aniversários da turma'}</h3>
          </div>
        </div>
        <div class="birthday-alert-list">
          ${itens.map(({ student, info }) => `
            <button type="button" onclick="window.app.openProfileModal('${escapeAttr(student.id)}')" class="birthday-alert-item ${info.hoje ? 'is-today' : ''}">
              <img src="${escapeAttr(safeUrl(student.photo) || criarAvatarPadrao(student.name))}" alt="${escapeAttr(student.name)}">
              <span>
                <strong>${escapeHTML(student.name)}</strong>
                <small>${escapeHTML(info.label)} · ${escapeHTML(info.proximoBR)}</small>
              </span>
            </button>
          `).join('')}
        </div>
      </section>
    `;
    container.classList.remove('hidden');
    refreshIcons();
  },

  atualizarIdentidadeDocenteUI() {
    const nome = formatarNomeProfessora(this.currentTeacherProfile?.nome) || 'Gestão Escolar';
    const email = this.currentTeacherProfile?.email || '';
    const texto = this.currentTeacherProfile ? `${nome}${email ? ` · ${email}` : ''}` : 'Gestão Escolar';

    ['teacher-sidebar-subtitle', 'mobile-teacher-sidebar-subtitle'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerText = texto;
    });
  },

  async refreshAfterWrite({ includeRoutine = false } = {}) {
    if (includeRoutine) {
      await this.recarregarDados();
    } else {
      await this.fetchStudents();
    }

    if (this.role === 'teacher') {
      const tabStudents = document.getElementById('tab-students');
      const tabRoutine = document.getElementById('tab-routine');
      if (tabStudents && !tabStudents.classList.contains('hidden-view')) this.renderStudentsList();
      if (includeRoutine && tabRoutine && !tabRoutine.classList.contains('hidden-view')) this.renderRoutine();
    }

    const modalAttendance = document.getElementById('modal-attendance');
    if (modalAttendance && !modalAttendance.classList.contains('hidden-view')) this.renderAttendanceList();

    const anyProfileModalOpen = ['modal-profile', 'modal-edit-student', 'modal-achievement', 'modal-achievements-list', 'modal-activity-create', 'modal-activities-list']
      .some(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden-view');
      });
    if (anyProfileModalOpen && this.currentStudentProfileId) {
      this.renderProfileInfo();
      this.renderProfileLists();
    }

    if (this.role === 'parent') this.renderParentView();
  },

  async fetchStudents({ silent = false } = {}) {
    try {
      const query = 'id,nome_aluno,idade,data_nascimento,nome_mae,nome_pai,contato_1,contato_2,endereco,responsavel_1,responsavel_2,responsavel_3,indicacoes,foto_url,professora_id,turma_id,chamadas(data_chamada,status),conquistas(id,descricao,tipo_medalha,created_at),atividades(id,data_atividade,descricao,tipo_atividade,feita)';
      const filtros = [];

      if (this.role === 'parent' && (!this.currentParentProfile?.aluno_ids || this.currentParentProfile.aluno_ids.length === 0)) {
        this.data.students = [];
        if (this.role === 'parent') this.renderParentView();
        return;
      }

      if (this.currentParentProfile?.aluno_ids?.length) {
        filtros.push(`id=in.(${this.currentParentProfile.aluno_ids.map(id => encodeURIComponent(id)).join(',')})`);
      } else if (this.currentTeacherProfile?.id) {
        filtros.push(`professora_id=eq.${encodeURIComponent(this.currentTeacherProfile.id)}`);
      }

      filtros.push('order=nome_aluno.asc');

      const data = await fetchDiretoDaAPI('alunos', query, filtros.join('&'));

      this.data.students = Array.isArray(data) ? data.map(dbStudent => {
        const dataHojeTexto = hojeISO();

        const achievements = Array.isArray(dbStudent.conquistas)
          ? dbStudent.conquistas.map(c => ({
              id: c.id,
              descricao: c.descricao || '',
              tipo: c.tipo_medalha || 'Conquista',
              date: c.created_at ? String(c.created_at).substring(0, 10) : dataHojeTexto
            })).sort((a, b) => String(b.date).localeCompare(String(a.date)))
          : [];

        const activities = Array.isArray(dbStudent.atividades)
          ? dbStudent.atividades.map(a => {
              const parsed = parseActivityDescription(a.descricao || '');
              return {
                id: a.id,
                date: a.data_atividade ? String(a.data_atividade).substring(0, 10) : dataHojeTexto,
                tipo: a.tipo_atividade || parsed.tipo,
                description: a.tipo_atividade ? (a.descricao || '') : parsed.texto,
                feita: a.feita !== false
              };
            }).sort((a, b) => String(b.date).localeCompare(String(a.date)))
          : [];

        const attendance = {};
        if (Array.isArray(dbStudent.chamadas)) {
          dbStudent.chamadas.forEach(c => {
            if (c && c.data_chamada) attendance[c.data_chamada] = c.status;
          });
        }

        const nome = dbStudent.nome_aluno || 'Aluno sem nome';
        const dataNascimento = dbStudent.data_nascimento ? String(dbStudent.data_nascimento).substring(0, 10) : '';
        const idadeCalculada = calcularIdadePorNascimento(dataNascimento);
        const idadeFinal = idadeCalculada !== null ? idadeCalculada : (dbStudent.idade ?? '');
        const professoraId = dbStudent.professora_id || '';
        const turmaId = dbStudent.turma_id || '';
        const professoraNome = this.getNomeProfessora(professoraId);
        const turmaNome = this.getNomeTurma(turmaId);

        return {
          id: dbStudent.id,
          name: nome,
          age: idadeFinal,
          birthDate: dataNascimento,
          nome_mae: dbStudent.nome_mae || '',
          nome_pai: dbStudent.nome_pai || '',
          contato_1: dbStudent.contato_1 || '',
          contato_2: dbStudent.contato_2 || '',
          endereco: dbStudent.endereco || '',
          responsavel_1: dbStudent.responsavel_1 || '',
          responsavel_2: dbStudent.responsavel_2 || '',
          responsavel_3: dbStudent.responsavel_3 || '',
          indicacoes: dbStudent.indicacoes || '',
          professora_id: professoraId,
          turma_id: turmaId,
          professora_nome: professoraNome,
          turma_nome: turmaNome,
          photo: safeUrl(dbStudent.foto_url) || criarAvatarPadrao(nome),
          info: turmaNome || professoraNome || `Filho(a) de ${dbStudent.nome_mae || 'Não informado.'}`,
          achievements,
          activities,
          attendance
        };
      }) : [];

      if (this.role === 'teacher') this.renderStudentsList();
    } catch (error) {
      if (!silent) mostrarErro(error, 'Carregamento de alunos');
      throw error;
    }
  },



  async fetchParentClassmates({ silent = false } = {}) {
    if (this.role !== 'parent' && !this.currentParentProfile) {
      this.data.parentClassmates = [];
      return [];
    }

    const turmasIds = Array.from(new Set((this.data.students || []).map(s => s.turma_id).filter(Boolean)));
    if (!turmasIds.length) {
      this.data.parentClassmates = [];
      return [];
    }

    try {
      const filtros = [
        `turma_id=in.(${turmasIds.map(id => encodeURIComponent(id)).join(',')})`,
        'order=nome_aluno.asc'
      ];

      const data = await fetchDiretoDaAPI(
        'alunos',
        'id,nome_aluno,idade,data_nascimento,foto_url,turma_id',
        filtros.join('&')
      );

      this.data.parentClassmates = Array.isArray(data) ? data.map(item => {
        const nascimento = item.data_nascimento ? String(item.data_nascimento).substring(0, 10) : '';
        const idadeCalculada = calcularIdadePorNascimento(nascimento);
        const nome = item.nome_aluno || 'Aluno';
        return {
          id: item.id,
          name: nome,
          age: idadeCalculada !== null ? idadeCalculada : (item.idade ?? ''),
          birthDate: nascimento,
          turma_id: item.turma_id || '',
          photo: safeUrl(item.foto_url) || criarAvatarPadrao(nome)
        };
      }) : [];

      return this.data.parentClassmates;
    } catch (err) {
      this.data.parentClassmates = [];
      if (!silent) mostrarErro(err, 'Carregamento dos coleguinhas');
      return [];
    }
  },

  async fetchGalleryPhotos({ silent = false } = {}) {
    try {
      const data = await fetchDiretoDaAPI(
        'fotos_galeria',
        'id,tipo_foto,titulo,legenda,url,path,professora_id,turma_id,aluno_id,categoria,evento_nome,destaque,ativo,data_foto,publicada_em,created_at',
        'ativo=eq.true&order=publicada_em.desc&limit=180'
      );

      const fotos = Array.isArray(data) ? data.map(item => {
        const tipoBruto = item.tipo_foto || 'turma';
        const tipoNormalizado = tipoBruto === 'aluno' ? 'individual' : tipoBruto;
        return {
          id: item.id,
          tipo: tipoNormalizado,
          tipo_foto: tipoNormalizado,
          titulo: item.titulo || (
            tipoNormalizado === 'individual'
              ? 'Foto individual'
              : tipoNormalizado === 'evento'
                ? (item.evento_nome || 'Evento escolar')
                : tipoNormalizado === 'geral'
                  ? 'Momento da escola'
                  : 'Foto da turma'
          ),
          descricao: item.legenda || '',
          legenda: item.legenda || '',
          url: safeUrl(item.url),
          storage_path: item.path || '',
          path: item.path || '',
          categoria: item.categoria || '',
          evento_nome: item.evento_nome || '',
          destaque: item.destaque === true,
          professora_id: item.professora_id || '',
          turma_id: item.turma_id || '',
          aluno_id: item.aluno_id || '',
          data_foto: item.data_foto || '',
          created_at: item.publicada_em || item.created_at || ''
        };
      }).filter(item => item.url) : [];

      this.data.galleryPhotos = fotos;
      await this.fetchGalleryInteractions({ silent: true });
      return fotos;
    } catch (err) {
      if (!silent) mostrarErro(err, 'Carregamento da galeria');
      this.data.galleryPhotos = [];
      this.data.galleryInteractions = { likes: [], comments: [], saved: [] };
      return [];
    }
  },

  async fetchGalleryInteractions({ silent = false } = {}) {
    try {
      const fotoIds = (this.data.galleryPhotos || []).map(f => f.id).filter(Boolean);
      if (!fotoIds.length) {
        this.data.galleryInteractions = { likes: [], comments: [], saved: [] };
        return this.data.galleryInteractions;
      }

      const inFilter = `foto_id=in.(${fotoIds.map(id => encodeURIComponent(id)).join(',')})`;
      const [likes, comments, saved] = await Promise.all([
        fetchDiretoDaAPI('foto_curtidas', 'id,foto_id,responsavel_id,created_at', `${inFilter}&order=created_at.desc`).catch(() => []),
        fetchDiretoDaAPI('foto_comentarios', 'id,foto_id,responsavel_id,comentario,ativo,created_at', `${inFilter}&ativo=eq.true&order=created_at.asc`).catch(() => []),
        this.currentParentProfile?.id
          ? fetchDiretoDaAPI('foto_salvos', 'id,foto_id,responsavel_id,created_at', `responsavel_id=eq.${encodeURIComponent(this.currentParentProfile.id)}&${inFilter}&order=created_at.desc`).catch(() => [])
          : Promise.resolve([])
      ]);

      this.data.galleryInteractions = {
        likes: Array.isArray(likes) ? likes : [],
        comments: Array.isArray(comments) ? comments : [],
        saved: Array.isArray(saved) ? saved : []
      };

      return this.data.galleryInteractions;
    } catch (err) {
      if (!silent) console.warn('Interações da galeria não carregadas.', err);
      this.data.galleryInteractions = { likes: [], comments: [], saved: [] };
      return this.data.galleryInteractions;
    }
  },

  getGalleryStats(fotoId) {
    const interactions = this.data.galleryInteractions || { likes: [], comments: [], saved: [] };
    const currentResponsavelId = this.currentParentProfile?.id || '';

    const likes = (interactions.likes || []).filter(item => String(item.foto_id) === String(fotoId));
    const comments = (interactions.comments || []).filter(item => String(item.foto_id) === String(fotoId));
    const saved = (interactions.saved || []).filter(item => String(item.foto_id) === String(fotoId));

    return {
      likesCount: likes.length,
      commentsCount: comments.length,
      savedCount: saved.length,
      likedByMe: !!currentResponsavelId && likes.some(item => String(item.responsavel_id) === String(currentResponsavelId)),
      savedByMe: !!currentResponsavelId && saved.some(item => String(item.responsavel_id) === String(currentResponsavelId)),
      comments
    };
  },

  getFotosVisiveisParaResponsavel() {
    const alunos = Array.isArray(this.data.students) ? this.data.students : [];
    const alunoIds = new Set(alunos.map(a => String(a.id)));
    const turmaIds = new Set(alunos.map(a => a.turma_id).filter(Boolean).map(String));

    return (this.data.galleryPhotos || []).filter(foto => {
      const tipo = foto.tipo_foto || foto.tipo || 'turma';
      if (tipo === 'individual' || tipo === 'aluno') {
        return foto.aluno_id && alunoIds.has(String(foto.aluno_id));
      }
      if (tipo === 'turma') {
        return foto.turma_id && turmaIds.has(String(foto.turma_id));
      }
      if (tipo === 'evento') {
        return !foto.turma_id || turmaIds.has(String(foto.turma_id));
      }
      if (tipo === 'geral') return true;
      return false;
    });
  },

  startGalleryRealtime() {
    this.stopGalleryRealtime();

    try {
      this.galleryRealtimeChannel = supabaseClient
        .channel('galeria-responsavel-tempo-real')
        .on(
          'postgres_changes',
          { event: '*', schema: DB_SCHEMA, table: 'fotos_galeria' },
          async () => {
            await this.fetchGalleryPhotos({ silent: true });
            if (this.role === 'parent') this.renderParentView();
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: DB_SCHEMA, table: 'foto_curtidas' },
          async () => {
            await this.fetchGalleryInteractions({ silent: true });
            if (this.role === 'parent') this.renderParentView();
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: DB_SCHEMA, table: 'foto_comentarios' },
          async () => {
            await this.fetchGalleryInteractions({ silent: true });
            if (this.role === 'parent') this.renderParentView();
          }
        )
        .subscribe();
    } catch (err) {
      console.warn('Realtime da galeria não iniciado. A galeria ainda será atualizada ao abrir/recarregar.', err);
      this.galleryRealtimeChannel = null;
    }
  },

  stopGalleryRealtime() {
    if (this.galleryRealtimeChannel) {
      try {
        supabaseClient.removeChannel(this.galleryRealtimeChannel);
      } catch (err) {
        console.warn('Falha ao remover canal realtime da galeria.', err);
      }
      this.galleryRealtimeChannel = null;
    }
  },

  async fetchRoutine({ silent = false } = {}) {
    try {
      const data = await fetchDiretoDaAPI('rotina_semanal', '*');
      const rotinaAtualizada = {
        'Segunda': '',
        'Terça': '',
        'Quarta': '',
        'Quinta': '',
        'Sexta': ''
      };

      if (Array.isArray(data)) {
        Object.keys(rotinaAtualizada).forEach(dia => {
          const item = data.find(d => d.dia_semana === dia);
          rotinaAtualizada[dia] = item && item.descricao ? item.descricao : '';
        });
      }

      this.data.routine = rotinaAtualizada;
    } catch (err) {
      if (!silent) mostrarErro(err, 'Carregamento da rotina');
      throw err;
    }
  },

  handleImageSelection(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Selecione um ficheiro de imagem válido.');
      event.target.value = '';
      return;
    }

    this.selectedFile = file;
    const reader = new FileReader();
    reader.onload = function(e) {
      const preview = document.getElementById('new-student-photo-preview');
      const icon = document.getElementById('new-student-photo-icon');
      if (preview && icon) {
        preview.src = e.target.result;
        preview.classList.remove('hidden');
        icon.classList.add('hidden');
      }
    };
    reader.readAsDataURL(file);
  },

  async uploadAvatar(file) {
    if (!file) return null;

    let fileExt = 'jpeg';
    if (file.name && file.name.includes('.')) {
      fileExt = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpeg';
    }

    const fileName = `${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;
    const { error: uploadError } = await supabaseClient.storage
      .from(STORAGE_BUCKET)
      .upload(fileName, file, { upsert: false, cacheControl: '60' });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabaseClient.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
    return publicUrlData.publicUrl + '?t=' + Date.now();
  },


  async uploadGalleryImage(file, pasta = 'turma') {
    if (!file) return null;

    let fileExt = 'jpeg';
    if (file.name && file.name.includes('.')) {
      fileExt = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpeg';
    }

    const teacherPart = this.currentTeacherProfile?.id || 'sem-professora';
    const fileName = `${teacherPart}/${pasta}/${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;

    const { error: uploadError } = await supabaseClient.storage
      .from(GALLERY_BUCKET)
      .upload(fileName, file, {
        upsert: false,
        cacheControl: '60',
        contentType: file.type || 'image/jpeg'
      });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabaseClient.storage.from(GALLERY_BUCKET).getPublicUrl(fileName);
    return {
      url: publicUrlData.publicUrl + '?t=' + Date.now(),
      path: fileName
    };
  },

  handleGalleryPhotoSelection(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Selecione uma imagem válida para a galeria.');
      event.target.value = '';
      return;
    }

    this.selectedGalleryFile = file;

    const preview = document.getElementById('gallery-photo-preview');
    const placeholder = document.getElementById('gallery-photo-placeholder');
    if (preview && placeholder) {
      const reader = new FileReader();
      reader.onload = e => {
        preview.src = e.target.result;
        preview.classList.remove('hidden');
        placeholder.classList.add('hidden');
      };
      reader.readAsDataURL(file);
    }
  },

  renderGallerySelectors() {
    const turmaSelect = document.getElementById('gallery-photo-turma');
    const alunoSelect = document.getElementById('gallery-photo-aluno');

    if (turmaSelect) {
      const turmas = this.getTurmasDisponiveis(this.currentTeacherProfile?.id || '');
      turmaSelect.innerHTML = [
        '<option value="">Selecione a turma</option>',
        ...turmas.map(t => `<option value="${escapeAttr(t.id)}">${escapeHTML(this.getNomeTurma(t.id) || t.nome)}</option>`)
      ].join('');

      const primeiraTurma = turmas[0];
      if (primeiraTurma) turmaSelect.value = primeiraTurma.id;
    }

    if (alunoSelect) {
      alunoSelect.innerHTML = [
        '<option value="">Selecione o aluno</option>',
        ...this.data.students.map(s => `<option value="${escapeAttr(s.id)}">${escapeHTML(s.name)}${s.turma_nome ? ` · ${escapeHTML(s.turma_nome)}` : ''}</option>`)
      ].join('');
    }

    this.selectGalleryPhotoType(this.galleryPhotoMode || 'turma');
  },

  openGalleryPhotoModal() {
    if (!this.currentTeacherProfile?.id) {
      alert('Entre como professora para adicionar fotos à galeria.');
      return;
    }

    this.closeCreateChoiceModal();
    this.closeMobileMenu();

    this.selectedGalleryFile = null;
    this.galleryPhotoMode = 'turma';

    const inputFile = document.getElementById('gallery-photo-file');
    const title = document.getElementById('gallery-photo-title');
    const desc = document.getElementById('gallery-photo-desc');
    const preview = document.getElementById('gallery-photo-preview');
    const placeholder = document.getElementById('gallery-photo-placeholder');

    if (inputFile) inputFile.value = '';
    if (title) title.value = '';
    if (desc) desc.value = '';
    if (preview) {
      preview.src = '';
      preview.classList.add('hidden');
    }
    if (placeholder) placeholder.classList.remove('hidden');

    this.renderGallerySelectors();

    const modal = document.getElementById('modal-gallery-photo');
    if (modal) {
      modal.classList.remove('hidden-view');
      lockBodyScroll();
    }

    refreshIcons();
  },

  closeGalleryPhotoModal() {
    const modal = document.getElementById('modal-gallery-photo');
    if (modal) modal.classList.add('hidden-view');

    this.selectedGalleryFile = null;

    const inputFile = document.getElementById('gallery-photo-file');
    if (inputFile) inputFile.value = '';

    unlockBodyScrollIfNoModal();
  },

  selectGalleryPhotoType(tipo = 'turma') {
    const tiposValidos = ['turma', 'aluno', 'evento', 'geral'];
    this.galleryPhotoMode = tiposValidos.includes(tipo) ? tipo : 'turma';

    document.querySelectorAll('[data-gallery-photo-type]').forEach(btn => {
      const ativo = btn.getAttribute('data-gallery-photo-type') === this.galleryPhotoMode;
      btn.classList.toggle('is-selected', ativo);
    });

    const turmaBox = document.getElementById('gallery-photo-turma-box');
    const alunoBox = document.getElementById('gallery-photo-aluno-box');
    const help = document.getElementById('gallery-photo-scope-help');

    const precisaTurma = this.galleryPhotoMode === 'turma' || this.galleryPhotoMode === 'evento';
    const precisaAluno = this.galleryPhotoMode === 'aluno';

    if (turmaBox) turmaBox.classList.toggle('hidden', !precisaTurma);
    if (alunoBox) alunoBox.classList.toggle('hidden', !precisaAluno);

    if (help) {
      const textos = {
        turma: 'A foto aparecerá para todos os responsáveis com filhos nesta turma.',
        aluno: 'A foto aparecerá somente para os responsáveis vinculados ao aluno selecionado.',
        evento: 'A foto aparecerá na aba de eventos para os responsáveis da turma selecionada.',
        geral: 'A foto aparecerá como publicação geral para os responsáveis.'
      };
      help.innerText = textos[this.galleryPhotoMode] || textos.turma;
    }
  },

  async saveGalleryPhoto() {
    if (this.isSaving) return;

    const btn = document.getElementById('btn-save-gallery-photo');
    const titulo = normalizarTexto(document.getElementById('gallery-photo-title')?.value);
    const legenda = normalizarTexto(document.getElementById('gallery-photo-desc')?.value);
    const tipo = this.galleryPhotoMode === 'aluno'
      ? 'individual'
      : ['turma', 'evento', 'geral'].includes(this.galleryPhotoMode)
        ? this.galleryPhotoMode
        : 'turma';

    if (!this.currentTeacherProfile?.id) {
      alert('Professora não identificada para registrar a foto.');
      return;
    }

    if (!this.selectedGalleryFile) {
      alert('Selecione uma foto antes de salvar.');
      return;
    }

    let turmaId = null;
    let alunoId = null;

    if (tipo === 'turma' || tipo === 'evento') {
      turmaId = valorOuNull(document.getElementById('gallery-photo-turma')?.value);
      if (!turmaId) {
        alert('Selecione a turma da foto.');
        return;
      }
    } else if (tipo === 'individual') {
      alunoId = valorOuNull(document.getElementById('gallery-photo-aluno')?.value);
      const aluno = this.data.students.find(s => String(s.id) === String(alunoId));
      if (!aluno) {
        alert('Selecione o aluno da foto individual.');
        return;
      }
      turmaId = valorOuNull(aluno.turma_id);
    }

    const btnOriginal = btn ? btn.innerHTML : '';
    this.isSaving = true;

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> A publicar foto...';
      refreshIcons();
    }

    try {
      const upload = await this.uploadGalleryImage(this.selectedGalleryFile, tipo);

      await mutateDiretoDaAPI('fotos_galeria', 'POST', {
        tipo_foto: tipo,
        titulo: titulo || (
          tipo === 'turma'
            ? 'Foto da turma'
            : tipo === 'individual'
              ? 'Foto individual'
              : tipo === 'evento'
                ? 'Evento escolar'
                : 'Momento da escola'
        ),
        legenda: legenda || null,
        url: upload.url,
        path: upload.path,
        professora_id: this.currentTeacherProfile.id,
        turma_id: turmaId,
        aluno_id: alunoId,
        categoria: tipo === 'evento' ? 'evento' : tipo,
        evento_nome: tipo === 'evento' ? (titulo || 'Evento escolar') : null,
        visibilidade: 'responsaveis',
        ativo: true,
        data_foto: hojeISO(),
        publicada_em: new Date().toISOString()
      });

      this.closeGalleryPhotoModal();
      await this.fetchGalleryPhotos({ silent: true });
      alert('Foto publicada na galeria com sucesso.');
    } catch (err) {
      mostrarErro(err, 'Publicação da foto');
    } finally {
      this.isSaving = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = btnOriginal || '<i data-lucide="send" class="w-4 h-4"></i> Publicar na galeria';
        refreshIcons();
      }
    }
  },

  async saveNewStudent() {
    if (this.isSaving) return;

    const getValue = id => normalizarTexto(document.getElementById(id)?.value);
    const nomeInput = getValue('input-new-nome');
    const dataNascimento = getValue('input-new-data-nascimento');
    const idadeNumero = calcularIdadePorNascimento(dataNascimento);
    const professoraSelecionada = valorOuNull(document.getElementById('input-new-professora')?.value) || this.currentTeacherProfile?.id || null;
    const turmaSelecionada = valorOuNull(document.getElementById('input-new-turma')?.value);

    const btnSave = document.getElementById('btn-save-student');

    if (!nomeInput || !dataNascimento) {
      alert('Preencha o Nome e a Data de nascimento.');
      return;
    }

    if (idadeNumero === null) {
      alert('Informe uma data de nascimento válida.');
      return;
    }

    this.isSaving = true;
    if (btnSave) {
      btnSave.innerHTML = 'A processar...';
      btnSave.disabled = true;
    }

    try {
      let fotoUrlFinal = null;

      if (this.selectedFile) {
        if (btnSave) btnSave.innerHTML = 'A carregar foto...';
        fotoUrlFinal = await this.uploadAvatar(this.selectedFile);
      }

      if (btnSave) btnSave.innerHTML = 'A guardar aluno...';

      const payload = {
        nome_aluno: nomeInput,
        idade: idadeNumero,
        data_nascimento: dataNascimento,
        nome_mae: getValue('input-new-mae') || null,
        nome_pai: getValue('input-new-pai') || null,
        contato_1: getValue('input-new-contato1') || null,
        contato_2: getValue('input-new-contato2') || null,
        endereco: getValue('input-new-endereco') || null,
        responsavel_1: getValue('input-new-resp1') || null,
        responsavel_2: getValue('input-new-resp2') || null,
        responsavel_3: getValue('input-new-resp3') || null,
        indicacoes: getValue('input-new-indicacoes') || null,
        professora_id: professoraSelecionada,
        turma_id: turmaSelecionada,
        foto_url: fotoUrlFinal
      };

      await mutateDiretoDaAPI('alunos', 'POST', payload);

      this.limparFormularioAluno();
      this.closeAddStudentModal();
      await this.refreshAfterWrite();
      alert('Aluno guardado com sucesso.');
    } catch (error) {
      mostrarErro(error, 'Gravação do aluno');
    } finally {
      this.isSaving = false;
      if (btnSave) {
        btnSave.innerHTML = 'Guardar Aluno';
        btnSave.disabled = false;
      }
    }
  },

  limparFormularioAluno() {
    const ids = [
      'input-new-nome', 'input-new-data-nascimento', 'input-new-mae', 'input-new-pai',
      'input-new-contato1', 'input-new-contato2', 'input-new-endereco',
      'input-new-resp1', 'input-new-resp2', 'input-new-resp3', 'input-new-indicacoes',
      'input-new-professora', 'input-new-turma'
    ];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    this.renderSchoolSelectors('new');
    this.atualizarIdadeCalculada('new');

    const inputFoto = document.getElementById('input-new-foto');
    if (inputFoto) inputFoto.value = '';
  },

  async toggleRoutineEdit() {
    const btnEdit = document.getElementById('btn-edit-routine');

    if (!this.isEditingRoutine) {
      this.isEditingRoutine = true;
      this.renderRoutine();
      return;
    }

    if (btnEdit) {
      btnEdit.innerHTML = 'A guardar...';
      btnEdit.disabled = true;
    }

    const atualizacoes = [];
    for (const day of Object.keys(this.data.routine)) {
      const input = document.getElementById(`input-routine-${day}`);
      const text = normalizarTexto(input?.value);
      atualizacoes.push({ dia_semana: day, descricao: text });
    }

    try {
      for (const item of atualizacoes) {
        const updateResult = await mutateDiretoDaAPI(
          'rotina_semanal',
          'PATCH',
          { descricao: item.descricao },
          `dia_semana=eq.${encodeURIComponent(item.dia_semana)}`
        );

        if (!Array.isArray(updateResult) || updateResult.length === 0) {
          await mutateDiretoDaAPI('rotina_semanal', 'POST', item);
        }
      }

      this.isEditingRoutine = false;
      await this.refreshAfterWrite({ includeRoutine: true });
      this.renderRoutine();
      alert('Rotina guardada com sucesso.');
    } catch (err) {
      mostrarErro(err, 'Gravação da rotina');
      this.isEditingRoutine = true;
      this.renderRoutine();
    } finally {
      if (btnEdit) btnEdit.disabled = false;
    }
  },

  async setAttendance(studentId, date, status) {
    const student = this.data.students.find(s => String(s.id) === String(studentId));
    if (!student) {
      alert('Aluno não encontrado para chamada.');
      return;
    }

    const dataChamada = date || hojeISO();

    if (dataChamada !== hojeISO()) {
      alert('Chamadas passadas ficam disponíveis apenas para visualização.');
      this.renderAttendanceList();
      return;
    }

    try {
      const updateResult = await mutateDiretoDaAPI(
        'chamadas',
        'PATCH',
        { status },
        `aluno_id=eq.${encodeURIComponent(studentId)}&data_chamada=eq.${encodeURIComponent(dataChamada)}`
      );

      if (!Array.isArray(updateResult) || updateResult.length === 0) {
        await mutateDiretoDaAPI('chamadas', 'POST', {
          aluno_id: studentId,
          data_chamada: dataChamada,
          status
        });
      }

      await this.refreshAfterWrite();
    } catch (err) {
      mostrarErro(err, 'Gravação da chamada');
      await this.refreshAfterWrite().catch(() => {});
    }
  },

  openAchievementModal() {
    const modal = document.getElementById('modal-achievement');
    const input = document.getElementById('modal-achievement-desc');
    if (!modal) {
      console.warn('Modal de conquista não encontrado no DOM.');
      return;
    }
    if (input) input.value = '';
    this.closeMobileMenu();
    this.selectAchievementType(this.selectedAchievementType || 'Cordial');
    modal.classList.remove('hidden-view');
    lockBodyScroll();
    setTimeout(() => input?.focus(), 80);
    refreshIcons();
  },

  closeAchievementModal() {
    const modal = document.getElementById('modal-achievement');
    if (modal) modal.classList.add('hidden-view');
    unlockBodyScrollIfNoModal();
  },

  selectAchievementType(tipo) {
    this.selectedAchievementType = tipo || 'Cordial';
    document.querySelectorAll('[data-achievement-select]').forEach(btn => {
      const ativo = btn.getAttribute('data-achievement-select') === this.selectedAchievementType;
      btn.classList.toggle('is-selected', ativo);
    });
  },

  openAchievementsListModal() {
    const modal = document.getElementById('modal-achievements-list');
    if (!modal) {
      console.warn('Modal de lista de conquistas não encontrado no DOM.');
      return;
    }
    this.closeMobileMenu();
    this.renderProfileLists();
    modal.classList.remove('hidden-view');
    lockBodyScroll();
    refreshIcons();
  },

  closeAchievementsListModal() {
    const modal = document.getElementById('modal-achievements-list');
    if (modal) modal.classList.add('hidden-view');
    unlockBodyScrollIfNoModal();
  },

  async addAchievement(tipo = null) {
    const tipoFinal = tipo || this.selectedAchievementType || 'Cordial';
    const input = document.getElementById('modal-achievement-desc') || document.getElementById('input-achievement-desc');
    const student = this.data.students.find(s => String(s.id) === String(this.currentStudentProfileId));

    if (!student || !this.currentStudentProfileId) {
      alert('Selecione um aluno válido antes de registrar a conquista.');
      return;
    }

    const descText = normalizarTexto(input ? input.value : '');
    const textoFinal = descText || `Recebeu a conquista: ${tipoFinal}`;

    const buttons = Array.from(document.querySelectorAll('[data-achievement-select], [data-achievement-type], #btn-save-achievement'));
    if (input) input.disabled = true;
    buttons.forEach(btn => btn.disabled = true);

    try {
      await mutateDiretoDaAPI('conquistas', 'POST', {
        aluno_id: this.currentStudentProfileId,
        descricao: textoFinal,
        tipo_medalha: tipoFinal
      });

      if (input) input.value = '';
      this.closeAchievementModal();
      await this.refreshAfterWrite();
    } catch (err) {
      mostrarErro(err, 'Inclusão de conquista');
    } finally {
      if (input) input.disabled = false;
      buttons.forEach(btn => btn.disabled = false);
    }
  },

  async removeAchievement(achievementId) {
    if (!achievementId) return;
    if (!confirm('Tem a certeza que deseja remover este prêmio?')) return;

    try {
      await mutateDiretoDaAPI(
        'conquistas',
        'DELETE',
        null,
        `id=eq.${encodeURIComponent(achievementId)}`,
        'return=minimal'
      );
      await this.refreshAfterWrite();
    } catch (err) {
      mostrarErro(err, 'Remoção do prêmio');
    }
  },

  toggleMedalHistory() {
    this.openAchievementsListModal();
  },

  toggleAchievementComposer(forceState = null) {
    if (forceState === false) this.closeAchievementModal();
    else this.openAchievementModal();
  },

  selectActivityType(tipo) {
    this.selectedActivityType = tipo || 'Classe';
    document.querySelectorAll('[data-activity-type]').forEach(btn => {
      const ativo = btn.getAttribute('data-activity-type') === this.selectedActivityType;
      btn.classList.toggle('is-selected', ativo);
    });
    const display = document.getElementById('modal-activity-kind-display');
    if (display) display.innerText = this.selectedActivityType;
  },

  selectActivityStatus(done = true) {
    this.selectedActivityDone = done === true;
    document.querySelectorAll('[data-activity-status]').forEach(btn => {
      const ativo = String(done) === btn.getAttribute('data-activity-status');
      btn.classList.toggle('is-selected', ativo);
    });
  },

  openActivityCreateModal(options = {}) {
    const modal = document.getElementById('modal-activity-create');
    if (!modal) {
      console.warn('Modal de inserção de atividade não encontrado no DOM.');
      return;
    }

    const isGlobal = options?.global === true;
    this.activityMode = isGlobal ? 'global' : 'student';
    this.closeMobileMenu();

    const input = document.getElementById('modal-activity-input');
    const dateInput = document.getElementById('modal-activity-date');
    const title = document.getElementById('modal-activity-title');
    const subtitle = document.getElementById('modal-activity-subtitle');
    const helpPill = document.getElementById('modal-activity-help-pill');
    const btn = document.getElementById('btn-add-activity');

    if (input) {
      input.value = '';
      input.placeholder = isGlobal
        ? 'Ex: Realizaram atividade de leitura coletiva e registro no caderno.'
        : 'Ex: Realizou atividade de leitura com apoio e reconheceu novas sílabas.';
    }
    if (dateInput) dateInput.value = hojeISO();

    if (title) title.innerText = isGlobal ? 'Nova atividade global' : 'Nova atividade';
    if (subtitle) {
      subtitle.innerText = isGlobal
        ? 'A atividade será registrada no perfil de todos os alunos carregados.'
        : 'Registre apenas uma nova atividade. A lista completa fica em outro modal.';
    }
    if (helpPill) {
      helpPill.innerHTML = isGlobal
        ? '<i data-lucide="users" class="w-4 h-4"></i> Toda a turma'
        : '<i data-lucide="clipboard-check" class="w-4 h-4"></i> Registro diário';
    }
    if (btn) {
      btn.innerHTML = isGlobal
        ? '<i data-lucide="save" class="w-4 h-4"></i> Salvar para todos'
        : '<i data-lucide="save" class="w-4 h-4"></i> Salvar atividade';
    }

    this.selectActivityType(this.selectedActivityType || 'Classe');
    this.selectActivityStatus(true);
    modal.classList.remove('hidden-view');
    lockBodyScroll();
    setTimeout(() => input?.focus(), 80);
    refreshIcons();
  },

  closeActivityCreateModal() {
    const modal = document.getElementById('modal-activity-create');
    if (modal) modal.classList.add('hidden-view');
    this.activityMode = 'student';
    unlockBodyScrollIfNoModal();
  },

  openActivitiesHistoryModal() {
    const modal = document.getElementById('modal-activities-list');
    if (!modal) {
      console.warn('Modal de histórico de atividades não encontrado no DOM.');
      return;
    }
    this.closeMobileMenu();
    this.renderProfileLists();
    modal.classList.remove('hidden-view');
    lockBodyScroll();
    refreshIcons();
  },

  closeActivitiesHistoryModal() {
    const modal = document.getElementById('modal-activities-list');
    if (modal) modal.classList.add('hidden-view');
    unlockBodyScrollIfNoModal();
  },

  openActivitiesModal(focusInput = false) {
    if (focusInput) this.openActivityCreateModal();
    else this.openActivitiesHistoryModal();
  },

  closeActivitiesModal() {
    this.closeActivityCreateModal();
    this.closeActivitiesHistoryModal();
  },


  async addActivity() {
    const input = document.getElementById('modal-activity-input') || document.getElementById('input-activity');
    const dateInput = document.getElementById('modal-activity-date');
    const btn = document.getElementById('btn-add-activity');
    const isGlobal = this.activityMode === 'global';
    const student = this.data.students.find(s => String(s.id) === String(this.currentStudentProfileId));
    const alunosDestino = Array.isArray(this.data.students)
      ? this.data.students.filter(s => s && s.id !== undefined && s.id !== null)
      : [];

    if (!input) {
      alert('Campo de atividade não encontrado.');
      return;
    }

    const textoAtividade = normalizarTexto(input.value);
    if (!textoAtividade) {
      alert('Descreva a atividade antes de salvar.');
      return;
    }

    if (isGlobal && alunosDestino.length === 0) {
      alert('Não há alunos carregados para receber esta atividade.');
      return;
    }

    if (!isGlobal && !student) {
      alert('Aluno não encontrado para adicionar atividade.');
      return;
    }

    const tipoAtividade = this.selectedActivityType || 'Classe';
    const dataAtividade = dateInput?.value || hojeISO();
    const feita = this.selectedActivityDone === true;
    const btnOriginalHTML = btn ? btn.innerHTML : '';

    input.disabled = true;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = isGlobal
        ? '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> A guardar para todos...'
        : '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> A guardar...';
      refreshIcons();
    }

    try {
      const payload = isGlobal
        ? alunosDestino.map(aluno => ({
            aluno_id: aluno.id,
            data_atividade: dataAtividade,
            tipo_atividade: tipoAtividade,
            descricao: textoAtividade,
            feita
          }))
        : {
            aluno_id: this.currentStudentProfileId,
            data_atividade: dataAtividade,
            tipo_atividade: tipoAtividade,
            descricao: textoAtividade,
            feita
          };

      await mutateDiretoDaAPI('atividades', 'POST', payload);

      input.value = '';
      this.closeActivityCreateModal();
      await this.refreshAfterWrite();

      if (isGlobal) {
        alert(`Atividade registrada para ${alunosDestino.length} aluno(s).`);
      }
    } catch (err) {
      mostrarErro(err, isGlobal ? 'Gravação da atividade global' : 'Gravação da atividade');
    } finally {
      input.disabled = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = btnOriginalHTML || '<i data-lucide="save" class="w-4 h-4"></i> Salvar atividade';
        refreshIcons();
      }
    }
  },

  async toggleActivityDone(activityId, done) {
    if (!activityId) return;
    try {
      await mutateDiretoDaAPI(
        'atividades',
        'PATCH',
        { feita: done === true },
        `id=eq.${encodeURIComponent(activityId)}`
      );
      await this.refreshAfterWrite();
    } catch (err) {
      mostrarErro(err, 'Atualização do estado da atividade');
    }
  },

  openCreateChoiceModal() {
    this.closeMobileMenu();
    const modal = document.getElementById('modal-create-choice');
    if (!modal) {
      this.openAddStudentModal();
      return;
    }
    modal.classList.remove('hidden-view');
    lockBodyScroll();
    refreshIcons();
  },

  closeCreateChoiceModal() {
    const modal = document.getElementById('modal-create-choice');
    if (modal) modal.classList.add('hidden-view');
    unlockBodyScrollIfNoModal();
  },

  chooseAddStudent() {
    this.closeCreateChoiceModal();
    this.openAddStudentModal();
  },

  openGlobalActivityModal() {
    if (!Array.isArray(this.data.students) || this.data.students.length === 0) {
      alert('Não há alunos carregados para receber uma atividade global.');
      return;
    }
    this.closeCreateChoiceModal();
    this.openActivityCreateModal({ global: true });
  },

  openAddStudentModal() {
    this.closeMobileMenu();
    this.renderSchoolSelectors('new');
    this.atualizarIdadeCalculada('new');
    const modal = document.getElementById('modal-add-student');
    if (modal) {
      modal.classList.remove('hidden-view');
      lockBodyScroll();
    }
  },

  closeAddStudentModal() {
    const modal = document.getElementById('modal-add-student');
    if (modal) modal.classList.add('hidden-view');
    unlockBodyScrollIfNoModal();

    this.selectedFile = null;

    const preview = document.getElementById('new-student-photo-preview');
    const icon = document.getElementById('new-student-photo-icon');
    const inputFoto = document.getElementById('input-new-foto');

    if (preview) {
      preview.src = '';
      preview.classList.add('hidden');
    }
    if (icon) icon.classList.remove('hidden');
    if (inputFoto) inputFoto.value = '';
  },

  openMobileMenu() {
    const overlay = document.getElementById('mobile-menu-overlay');
    const sidebar = document.getElementById('mobile-sidebar');
    if (!overlay || !sidebar) return;

    overlay.classList.remove('hidden-view');
    requestAnimationFrame(() => {
      overlay.classList.remove('opacity-0');
      sidebar.classList.remove('-translate-x-full');
    });
  },

  closeMobileMenu() {
    const overlay = document.getElementById('mobile-menu-overlay');
    const sidebar = document.getElementById('mobile-sidebar');
    if (!overlay || !sidebar) return;

    overlay.classList.add('opacity-0');
    sidebar.classList.add('-translate-x-full');
    setTimeout(() => {
      overlay.classList.add('hidden-view');
    }, 300);
  },

  resetNavigationState({ showLogin = false } = {}) {
    const idsParaFechar = [
      'view-teacher',
      'view-parent',
      'modal-create-choice',
      'modal-attendance',
      'modal-add-student',
      'modal-profile',
      'modal-edit-student',
      'modal-achievement',
      'modal-achievements-list',
      'modal-activity-create',
      'modal-activities-list'
    ];

    idsParaFechar.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden-view');
    });

    const viewLogin = document.getElementById('view-login');
    if (viewLogin) {
      if (showLogin) viewLogin.classList.remove('hidden-view');
      else viewLogin.classList.add('hidden-view');
    }

    this.closeMobileMenu();
    this.currentStudentProfileId = null;
    this.isEditingRoutine = false;
    syncBodyScrollLock();
  },

  async login(role, childId = null) {
    this.resetNavigationState({ showLogin: false });

    this.role = role;

    if (role === 'teacher') {
      this.activeChildId = null;
      const viewTeacher = document.getElementById('view-teacher');
      if (viewTeacher) viewTeacher.classList.remove('hidden-view');
      this.atualizarIdentidadeDocenteUI();
      this.switchTeacherTab('students');
      return;
    }

    if (role === 'parent') {
      if (!this.data.students.length) {
        try {
          await this.carregarDadosPublicosIniciais();
        } catch (err) {
          mostrarErro(err, 'Carregamento do diário dos pais');
          this.resetNavigationState({ showLogin: true });
          return;
        }
      }

      const fallbackChildId = childId || this.data.students[0]?.id || null;
      this.activeChildId = fallbackChildId;
      const viewParent = document.getElementById('view-parent');
      if (viewParent) viewParent.classList.remove('hidden-view');
      this.renderParentView();
    }
  },

  async logout() {
    try {
      if (this.authSession) await supabaseClient.auth.signOut();
    } catch (err) {
      console.warn('Falha ao terminar sessão Supabase.', err);
    }

    this.role = null;
    this.activeChildId = null;
    this.authSession = null;
    this.authUser = null;
    this.currentTeacherProfile = null;
    this.currentParentProfile = null;
    this.stopGalleryRealtime();
    this.data.students = [];
    this.data.galleryPhotos = [];
    this.resetNavigationState({ showLogin: true });
    this.atualizarIdentidadeDocenteUI();
  },

  switchTeacherTab(tabId) {
    const tabs = ['students', 'routine'];

    tabs.forEach(id => {
      const tab = document.getElementById(`tab-${id}`);
      if (tab) tab.classList.add('hidden-view');

      const btn = document.getElementById(`tab-btn-${id}`);
      if (btn) btn.className = 'w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors text-slate-600 hover:bg-slate-50';

      const mobBtn = document.getElementById(`mob-side-tab-${id}`);
      if (mobBtn) mobBtn.className = 'w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-medium transition-colors text-slate-600 hover:bg-slate-50';
    });

    const activeTab = document.getElementById(`tab-${tabId}`);
    if (activeTab) activeTab.classList.remove('hidden-view');

    const btnActive = document.getElementById(`tab-btn-${tabId}`);
    if (btnActive) btnActive.className = 'w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors bg-blue-50 text-blue-700';

    const mobActive = document.getElementById(`mob-side-tab-${tabId}`);
    if (mobActive) mobActive.className = 'w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-medium transition-colors bg-blue-50 text-blue-700';

    const titleEl = document.getElementById('mobile-header-title');
    const headerAddBtn = document.getElementById('mobile-header-add-btn');
    if (titleEl) titleEl.innerText = tabId === 'students' ? 'A Minha Turma' : 'Rotina Semanal';
    if (headerAddBtn) {
      if (tabId === 'students') headerAddBtn.classList.remove('hidden');
      else headerAddBtn.classList.add('hidden');
    }

    if (tabId === 'students') this.renderStudentsList();
    if (tabId === 'routine') this.renderRoutine();
  },

  renderStudentsList() {
    const grid = document.getElementById('students-grid');
    if (!grid) return;

    const dateInput = document.getElementById('attendance-date');
    const dateToday = dateInput?.value || hojeISO();

    let presentes = 0;
    let faltas = 0;
    let conquistasTotal = 0;

    this.data.students.forEach(s => {
      if (s.attendance[dateToday] === 'presente') presentes++;
      if (s.attendance[dateToday] === 'ausente') faltas++;
      conquistasTotal += Array.isArray(s.achievements) ? s.achievements.length : 0;
    });

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.innerText = value;
    };

    setText('stat-total', this.data.students.length);
    setText('stat-presentes', presentes);
    setText('stat-faltas', faltas);
    setText('stat-conquistas', conquistasTotal);
    this.renderBirthdayAlerts();

    if (this.data.students.length === 0) {
      grid.innerHTML = `<div class="col-span-full p-8 text-center text-slate-400 bg-white rounded-2xl border border-dashed border-slate-300">Nenhum aluno cadastrado ainda.</div>`;
      return;
    }

    grid.innerHTML = this.data.students.map(s => {
      const statusHoje = s.attendance[dateToday] || 'pendente';
      const statusLabel = statusHoje === 'presente'
        ? 'Presente'
        : statusHoje === 'ausente'
          ? 'Ausente'
          : 'Sem chamada';
      const statusTextClass = statusHoje === 'presente'
        ? 'text-emerald-700'
        : statusHoje === 'ausente'
          ? 'text-red-700'
          : 'text-amber-700';
      const statusDotClass = statusHoje === 'presente'
        ? 'bg-emerald-500'
        : statusHoje === 'ausente'
          ? 'bg-red-500'
          : 'bg-amber-400';

      const conquistasQtd = Array.isArray(s.achievements) ? s.achievements.length : 0;
      const conquistasTextClass = conquistasQtd > 0 ? 'text-amber-700' : 'text-slate-500';
      const turmaLabel = s.turma_nome || 'Sem turma definida';
      const turmaTextClass = s.turma_nome ? 'text-blue-700' : 'text-slate-500';
      const professoraLabel = s.professora_nome || this.getNomeProfessora(s.professora_id) || formatarNomeProfessora(this.currentTeacherProfile?.nome) || 'Sem professora';
      const professoraTextClass = professoraLabel === 'Sem professora' ? 'text-slate-500' : 'text-indigo-700';
      const aniversarioInfo = obterProximoAniversarioInfo(s.birthDate);
      const idadeTexto = formatarIdadeCalculada(Number.isInteger(Number(s.age)) ? Number(s.age) : null);
      const aniversarioTexto = aniversarioInfo?.hoje
        ? 'Aniversário hoje 🎂'
        : aniversarioInfo && aniversarioInfo.dias <= 30
          ? aniversarioInfo.label
          : (s.birthDate ? `Nasc.: ${formatarDataBR(s.birthDate)}` : 'Nascimento não informado');
      const aniversarioClass = aniversarioInfo?.hoje
        ? 'text-rose-600 font-extrabold'
        : aniversarioInfo && aniversarioInfo.dias <= 30
          ? 'text-amber-700 font-bold'
          : 'text-slate-500 font-medium';

      return `
        <div onclick="window.app.openProfileModal('${escapeAttr(s.id)}')" class="group bg-white/95 rounded-2xl p-4 shadow-sm border border-slate-100 active:scale-[0.99] hover:-translate-y-px hover:shadow-md transition-all touch-manipulation cursor-pointer app-card min-h-[150px]">
          <div class="flex items-start gap-4 h-full">
            <div class="relative flex-shrink-0">
              <img
                src="${escapeAttr(safeUrl(s.photo) || criarAvatarPadrao(s.name))}"
                alt="${escapeAttr(s.name)}"
                class="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-200 shadow-sm object-cover"
              >
              <span class="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center border-2 border-white shadow-sm">
                <i data-lucide="chevron-right" class="w-3 h-3"></i>
              </span>
            </div>

            <div class="min-w-0 flex-1 flex flex-col justify-between">
              <div>
                <h3 class="font-extrabold text-xl text-slate-800 leading-tight truncate">${escapeHTML(s.name)}</h3>
                <p class="text-sm text-slate-500 mt-0.5">${escapeHTML(idadeTexto)}</p>
                <p class="text-xs mt-1 ${aniversarioClass}">${escapeHTML(aniversarioTexto)}</p>
              </div>

              <div class="mt-3 space-y-1.5">
                <div class="flex items-center justify-between gap-3 text-sm">
                  <span class="text-slate-500 font-medium">Presença</span>
                  <span class="inline-flex items-center gap-1.5 font-extrabold text-right ${statusTextClass}">
                    <span class="w-2 h-2 rounded-full ${statusDotClass}"></span>
                    ${escapeHTML(statusLabel)}
                  </span>
                </div>

                <div class="flex items-center justify-between gap-3 text-sm">
                  <span class="text-slate-500 font-medium">Conquistas</span>
                  <span class="font-extrabold text-right ${conquistasTextClass}">${conquistasQtd}</span>
                </div>

                <div class="pt-2 border-t border-slate-100 grid grid-cols-2 gap-3">
                  <div class="min-w-0">
                    <p class="text-[12px] text-slate-500 font-medium mb-0.5">Turma</p>
                    <p class="text-sm font-extrabold truncate ${turmaTextClass}">${escapeHTML(turmaLabel)}</p>
                  </div>
                  <div class="min-w-0">
                    <p class="text-[12px] text-slate-500 font-medium mb-0.5">Professora</p>
                    <p class="text-sm font-extrabold truncate ${professoraTextClass}">${escapeHTML(professoraLabel)}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  renderRoutine() {
    const container = document.getElementById('routine-list');
    const btnEdit = document.getElementById('btn-edit-routine');

    if (btnEdit) {
      btnEdit.innerHTML = this.isEditingRoutine ? `<i data-lucide="save" class="w-5 h-5"></i> Guardar` : 'Editar Rotina';
      btnEdit.className = this.isEditingRoutine
        ? 'flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-xl touch-manipulation font-medium'
        : 'flex items-center gap-2 bg-slate-200 text-slate-700 px-4 py-2 rounded-xl touch-manipulation font-medium';
    }

    let html = '';
    for (const [day, text] of Object.entries(this.data.routine)) {
      html += `
        <div class="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center gap-3">
          <div class="w-28 font-bold text-blue-600 flex items-center gap-2 text-sm md:text-base">
            <i data-lucide="clock" class="w-4 h-4"></i> ${escapeHTML(day)}
          </div>
          ${this.isEditingRoutine
            ? `<textarea id="input-routine-${escapeAttr(day)}" class="flex-1 border border-slate-300 rounded-xl p-3 text-sm focus:border-blue-500 outline-none w-full bg-slate-50" rows="2">${escapeHTML(text)}</textarea>`
            : `<div class="flex-1 text-slate-700 text-sm leading-relaxed">${escapeHTML(text || 'Sem rotina cadastrada.')}</div>`
          }
        </div>
      `;
    }

    if (container) container.innerHTML = html;
    refreshIcons();
  },

  openAttendanceModal() {
    this.closeMobileMenu();
    const modal = document.getElementById('modal-attendance');
    const dateInput = document.getElementById('attendance-date');

    if (dateInput && !dateInput.value) dateInput.value = hojeISO();
    if (modal) modal.classList.remove('hidden-view');

    lockBodyScroll();
    this.renderAttendanceList();
  },

  closeAttendanceModal() {
    const modal = document.getElementById('modal-attendance');
    if (modal) modal.classList.add('hidden-view');
    unlockBodyScrollIfNoModal();
  },

  getAttendanceStatusMeta(status) {
    if (status === 'presente') {
      return {
        label: 'Presente',
        short: 'Presente',
        icon: 'check-circle-2',
        rowClass: 'attendance-row-present',
        badgeClass: 'attendance-status-present'
      };
    }

    if (status === 'ausente') {
      return {
        label: 'Falta registrada',
        short: 'Falta',
        icon: 'x-circle',
        rowClass: 'attendance-row-absent',
        badgeClass: 'attendance-status-absent'
      };
    }

    return {
      label: 'Pendente',
      short: 'Pendente',
      icon: 'clock-3',
      rowClass: 'attendance-row-pending',
      badgeClass: 'attendance-status-pending'
    };
  },

  getAttendanceSummary(date) {
    const total = this.data.students.length;
    let presentes = 0;
    let ausentes = 0;

    this.data.students.forEach(student => {
      const status = student?.attendance?.[date];
      if (status === 'presente') presentes++;
      if (status === 'ausente') ausentes++;
    });

    const registrados = presentes + ausentes;
    const pendentes = Math.max(total - registrados, 0);
    const progresso = total ? Math.round((registrados / total) * 100) : 0;

    return {
      total,
      presentes,
      ausentes,
      pendentes,
      registrados,
      progresso,
      completa: total > 0 && pendentes === 0
    };
  },

  getAttendanceRegisteredDates() {
    const datas = new Set();

    this.data.students.forEach(student => {
      Object.entries(student?.attendance || {}).forEach(([data, status]) => {
        if (data && status) datas.add(data);
      });
    });

    return Array.from(datas).sort((a, b) => String(b).localeCompare(String(a)));
  },

  switchAttendanceDate(date) {
    const dateInput = document.getElementById('attendance-date');
    if (dateInput) dateInput.value = date || hojeISO();
    this.renderAttendanceList();
  },

  renderAttendanceList() {
    const dateInput = document.getElementById('attendance-date');
    const date = dateInput?.value || hojeISO();
    const today = hojeISO();
    const list = document.getElementById('attendance-list');
    if (!list) return;

    if (this.data.students.length === 0) {
      list.innerHTML = `
        <div class="attendance-empty-state">
          <div class="attendance-empty-icon"><i data-lucide="users" class="w-7 h-7"></i></div>
          <h3>Nenhum aluno cadastrado</h3>
          <p>Cadastre alunos antes de fazer a chamada da turma.</p>
        </div>
      `;
      refreshIcons();
      return;
    }

    const isToday = date === today;
    const isReadOnly = !isToday;
    const summary = this.getAttendanceSummary(date);
    const datasRegistradas = this.getAttendanceRegisteredDates();
    const datasHistorico = datasRegistradas.filter(data => data !== date).slice(0, 10);

    const historicoHTML = datasHistorico.length
      ? datasHistorico.map(dataItem => {
          const resumoItem = this.getAttendanceSummary(dataItem);
          const ativo = dataItem === date;
          return `
            <button type="button" onclick="window.app.switchAttendanceDate('${escapeAttr(dataItem)}')" class="attendance-history-item-btn ${ativo ? 'is-active' : ''}">
              <span>
                <strong>${escapeHTML(formatarDataBR(dataItem))}</strong>
                <small>${resumoItem.presentes} presença(s) · ${resumoItem.ausentes} falta(s)</small>
              </span>
              <span class="attendance-history-progress">${resumoItem.progresso}%</span>
            </button>
          `;
        }).join('')
      : `
        <div class="attendance-history-empty">
          <i data-lucide="archive" class="w-4 h-4"></i>
          Ainda não há chamadas anteriores para visualizar.
        </div>
      `;

    const rowsHTML = this.data.students.map(student => {
      const status = student.attendance?.[date] || null;
      const meta = this.getAttendanceStatusMeta(status);
      const turmaTexto = student.turma_nome || 'Turma não definida';

      return `
        <article class="attendance-student-row ${meta.rowClass}">
          <div class="attendance-student-main">
            <img src="${escapeAttr(safeUrl(student.photo) || criarAvatarPadrao(student.name))}" alt="${escapeAttr(student.name)}" class="attendance-student-photo">
            <div class="min-w-0">
              <h3>${escapeHTML(student.name)}</h3>
              <p>${escapeHTML(turmaTexto)}</p>
            </div>
          </div>

          <div class="attendance-student-status">
            <span class="attendance-status-chip ${meta.badgeClass}">
              <i data-lucide="${meta.icon}" class="w-4 h-4"></i>
              ${escapeHTML(meta.label)}
            </span>

            ${isReadOnly
              ? `
                <span class="attendance-readonly-chip">
                  <i data-lucide="lock" class="w-3.5 h-3.5"></i>
                  Somente visualização
                </span>
              `
              : `
                <div class="attendance-actions">
                  <button type="button" onclick="window.app.setAttendance('${escapeAttr(student.id)}', '${escapeAttr(date)}', 'presente')" class="attendance-action-btn attendance-action-present ${status === 'presente' ? 'is-active' : ''}">
                    <i data-lucide="check-circle-2" class="w-4 h-4"></i>
                    Presente
                  </button>
                  <button type="button" onclick="window.app.setAttendance('${escapeAttr(student.id)}', '${escapeAttr(date)}', 'ausente')" class="attendance-action-btn attendance-action-absent ${status === 'ausente' ? 'is-active' : ''}">
                    <i data-lucide="x-circle" class="w-4 h-4"></i>
                    Falta
                  </button>
                </div>
              `
            }
          </div>
        </article>
      `;
    }).join('');

    list.innerHTML = `
      <div class="attendance-modal-content">
        <section class="attendance-summary-card">
          <div class="attendance-summary-top">
            <div>
              <p class="attendance-eyebrow">Controle diário</p>
              <h2>Chamada de ${escapeHTML(formatarDataBR(date))}</h2>
              <p>${isReadOnly ? 'Chamada passada aberta em modo somente visualização.' : 'Marque presença ou falta. As alterações são salvas no Supabase.'}</p>
            </div>

            <div class="attendance-date-actions">
              <span class="attendance-mode-badge ${isReadOnly ? 'is-readonly' : 'is-editable'}">
                <i data-lucide="${isReadOnly ? 'lock' : 'pencil-line'}" class="w-4 h-4"></i>
                ${isReadOnly ? 'Histórico' : 'Editável hoje'}
              </span>
              ${isReadOnly ? `<button type="button" onclick="window.app.switchAttendanceDate('${escapeAttr(today)}')" class="attendance-today-btn">Voltar para hoje</button>` : ''}
            </div>
          </div>

          <div class="attendance-progress-wrap">
            <div class="attendance-progress-line">
              <span>Progresso da chamada</span>
              <strong>${summary.progresso}%</strong>
            </div>
            <div class="attendance-progress-track">
              <div class="attendance-progress-fill" style="width:${summary.progresso}%"></div>
            </div>
          </div>

          <div class="attendance-summary-grid">
            <div class="attendance-mini-stat">
              <span class="stat-total"><i data-lucide="users" class="w-4 h-4"></i></span>
              <small>Total</small>
              <strong>${summary.total}</strong>
            </div>
            <div class="attendance-mini-stat">
              <span class="stat-present"><i data-lucide="check-circle-2" class="w-4 h-4"></i></span>
              <small>Presentes</small>
              <strong>${summary.presentes}</strong>
            </div>
            <div class="attendance-mini-stat">
              <span class="stat-absent"><i data-lucide="x-circle" class="w-4 h-4"></i></span>
              <small>Faltas</small>
              <strong>${summary.ausentes}</strong>
            </div>
            <div class="attendance-mini-stat">
              <span class="stat-pending"><i data-lucide="clock-3" class="w-4 h-4"></i></span>
              <small>Pendentes</small>
              <strong>${summary.pendentes}</strong>
            </div>
          </div>
        </section>

        <section class="attendance-history-card">
          <div class="attendance-card-heading">
            <div>
              <p class="attendance-eyebrow">Histórico</p>
              <h3>Chamadas registradas</h3>
            </div>
            <i data-lucide="history" class="w-5 h-5"></i>
          </div>
          <div class="attendance-history-list">
            ${historicoHTML}
          </div>
        </section>

        <section class="attendance-list-card">
          <div class="attendance-card-heading">
            <div>
              <p class="attendance-eyebrow">${isReadOnly ? 'Visualização' : 'Lançamento'}</p>
              <h3>Lista da turma</h3>
            </div>
            <span class="attendance-list-counter">${summary.registrados}/${summary.total}</span>
          </div>
          <div class="attendance-students-list">
            ${rowsHTML}
          </div>
        </section>
      </div>
    `;

    refreshIcons();
  },

  openProfileModal(studentId) {
    const s = this.data.students.find(s => String(s.id) === String(studentId));

    if (!s) {
      alert('Aluno não encontrado.');
      return;
    }

    this.currentStudentProfileId = studentId;

    const profileHeader = document.getElementById('profile-header');
    if (profileHeader) {
      profileHeader.innerHTML = `
        <button onclick="window.app.closeProfileModal()" class="p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-full transition-colors touch-manipulation">
          <i data-lucide="arrow-left" class="w-6 h-6"></i>
        </button>
        <div class="flex-1 min-w-0">
          <h2 class="text-xl font-bold text-slate-800 leading-tight">Perfil do Aluno</h2>
          <p class="text-xs text-slate-500 hidden sm:block">Dados, presença, comportamento e evolução pedagógica</p>
        </div>
        <button onclick="window.app.toggleStudentEdit(true)" class="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors touch-manipulation">
          <i data-lucide="pencil" class="w-4 h-4"></i> <span class="hidden sm:inline">Editar ficha</span>
        </button>
      `;
    }

    const headerInfo = document.getElementById('profile-header-info');
    const aniversarioInfo = obterProximoAniversarioInfo(s.birthDate);
    const idadeTexto = formatarIdadeCalculada(Number.isInteger(Number(s.age)) ? Number(s.age) : null);
    const nascimentoTexto = s.birthDate ? `Nascimento: ${formatarDataBR(s.birthDate)}` : 'Data de nascimento não informada';
    const aniversarioResumo = aniversarioInfo
      ? (aniversarioInfo.hoje ? 'Aniversário hoje 🎂' : aniversarioInfo.label)
      : 'Aniversário não calculado';

    if (headerInfo) {
      headerInfo.innerHTML = `
        <div class="profile-student-hero">
          <div class="profile-photo-hero group cursor-pointer" onclick="document.getElementById('input-update-foto').click()">
            <input type="file" id="input-update-foto" accept="image/*" class="hidden" onchange="app.updateProfilePhoto(event)">
            <img id="profile-current-photo" src="${escapeAttr(safeUrl(s.photo) || criarAvatarPadrao(s.name))}" class="w-full h-full object-cover">
            <div class="profile-photo-overlay">
              <i data-lucide="camera" class="text-white w-7 h-7"></i>
            </div>
            <div id="profile-photo-loading" class="absolute inset-0 bg-white/80 flex flex-col items-center justify-center hidden">
              <i data-lucide="loader-2" class="text-blue-500 w-6 h-6 animate-spin"></i>
            </div>
          </div>
          <div class="mt-4">
            <p class="profile-eyebrow">Ficha individual</p>
            <h2 class="text-2xl lg:text-3xl font-bold leading-tight text-slate-900">${escapeHTML(s.name)}</h2>
            <p class="text-slate-500 text-sm mt-1">${escapeHTML(idadeTexto)} · ${escapeHTML(nascimentoTexto)}</p>
            <p class="text-sm mt-1 ${aniversarioInfo?.hoje ? 'text-rose-600 font-extrabold' : 'text-amber-700 font-bold'}">${escapeHTML(aniversarioResumo)}</p>
            <div class="mt-3 flex flex-wrap gap-2">
              ${s.turma_nome ? `<span class="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-100 px-2.5 py-1 text-[11px] font-bold text-blue-700"><i data-lucide="graduation-cap" class="w-3 h-3"></i>${escapeHTML(s.turma_nome)}</span>` : ''}
              ${s.professora_nome ? `<span class="inline-flex items-center gap-1 rounded-full bg-slate-50 border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-600"><i data-lucide="user-round" class="w-3 h-3"></i>${escapeHTML(s.professora_nome)}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }

    this.renderProfileInfo();
    this.toggleStudentEdit(false);
    this.renderProfileLists();

    const modal = document.getElementById('modal-profile');
    if (modal) modal.classList.remove('hidden-view');

    refreshIcons();
  },

  closeProfileModal() {
    ['modal-profile', 'modal-edit-student', 'modal-achievement', 'modal-achievements-list', 'modal-activity-create', 'modal-activities-list'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden-view');
    });
    unlockBodyScrollIfNoModal();

    const list = document.getElementById('profile-achievements');
    const icon = document.getElementById('icon-medal-history');

    if (list && icon) {
      list.classList.add('hidden');
      icon.style.transform = 'rotate(0deg)';
    }

    this.currentStudentProfileId = null;
  },

  renderProfileInfo() {
    const s = this.data.students.find(s => String(s.id) === String(this.currentStudentProfileId));
    if (!s) return;

    const metricas = calcularMetricasAluno(s);

    const setText = (id, value, fallback = '-') => {
      const el = document.getElementById(id);
      if (el) el.innerText = value ? String(value) : fallback;
    };

    const aniversarioInfo = obterProximoAniversarioInfo(s.birthDate);
    setText('profile-professora', s.professora_nome || this.getNomeProfessora(s.professora_id), 'Sem professora vinculada');
    setText('profile-turma', s.turma_nome || this.getNomeTurma(s.turma_id), 'Sem turma vinculada');
    setText('profile-data-nascimento', s.birthDate ? `${formatarDataBR(s.birthDate)} · ${formatarIdadeCalculada(Number.isInteger(Number(s.age)) ? Number(s.age) : null)}` : '', 'Não informada');
    setText('profile-proximo-aniversario', aniversarioInfo ? `${aniversarioInfo.proximoBR} · ${aniversarioInfo.label}` : '', 'Não calculado');
    setText('profile-mae', s.nome_mae);
    setText('profile-pai', s.nome_pai);
    setText('profile-contato1', s.contato_1);
    setText('profile-contato2', s.contato_2);
    setText('profile-endereco', s.endereco);

    const responsaveis = [s.responsavel_1, s.responsavel_2, s.responsavel_3].filter(Boolean).join(', ');
    setText('profile-responsaveis', responsaveis, 'Nenhum responsável extra cadastrado');

    const indicacoesEl = document.getElementById('profile-indicacoes');
    const indicacoesContainer = document.getElementById('profile-indicacoes-container');
    if (indicacoesEl && indicacoesContainer) {
      if (s.indicacoes) {
        indicacoesEl.innerText = s.indicacoes;
        indicacoesContainer.classList.remove('hidden');
      } else {
        indicacoesContainer.classList.add('hidden');
      }
    }

    const btnWhats = document.getElementById('profile-whatsapp');
    if (btnWhats) {
      if (s.contato_1) {
        const num = String(s.contato_1).replace(/\D/g, '');
        btnWhats.href = `https://wa.me/${num}`;
        btnWhats.classList.remove('hidden');
        btnWhats.classList.add('flex');
      } else {
        btnWhats.classList.add('hidden');
        btnWhats.classList.remove('flex');
      }
    }
    const overview = document.getElementById('profile-overview-cards');
    if (overview) {
      overview.innerHTML = `
        ${this.renderMetricCard('calendar-check', 'Presença', `${metricas.presencaPct}%`, metricas.presencaNivel, 'emerald')}
        ${this.renderMetricCard('smile-plus', 'Comportamento', `${metricas.comportamentoPct}%`, metricas.comportamentoNivel, 'blue')}
        ${this.renderMetricCard('book-open-check', 'Atividades', String(metricas.atividades), metricas.atividadeNivel, 'violet')}
        ${this.renderMetricCard('trophy', 'Conquistas', String(metricas.conquistas), `${metricas.ocorrencias} ocorrência(s)`, 'amber')}
      `;
    }

    const analysis = document.getElementById('profile-analysis-card');
    if (analysis) {
      const presencaTexto = metricas.totalChamadas
        ? `${metricas.presencas} presença(s) e ${metricas.faltas} falta(s) registradas.`
        : 'Sem registros de chamada para calcular frequência.';
      const comportamentoTexto = metricas.conquistas
        ? `${metricas.positivas} registro(s) positivo(s) e ${metricas.ocorrencias} ocorrência(s).`
        : 'Sem registros de comportamento até agora.';
      const atividadeTexto = metricas.atividades
        ? `Última atividade: ${escapeHTML(metricas.ultimaAtividade?.description || 'Atividade registrada')}`
        : 'Nenhuma atividade pedagógica registrada até agora.';
      const aniversarioTexto = aniversarioInfo
        ? (aniversarioInfo.hoje ? `${escapeHTML(s.name)} faz aniversário hoje e completa ${aniversarioInfo.idadeAoCompletar} ano(s).` : `Próximo aniversário em ${aniversarioInfo.proximoBR}: ${aniversarioInfo.label}.`)
        : 'Cadastre a data de nascimento para acompanhar crescimento e aniversários.';

      analysis.innerHTML = `
        <div class="profile-section-heading mb-5">
          <div>
            <p class="profile-eyebrow">Análise pedagógica</p>
            <h3 class="profile-title">Leitura rápida para acompanhamento</h3>
            <p class="profile-subtitle">Resumo gerado com base nos dados já registrados no sistema.</p>
          </div>
        </div>
        <div class="profile-analysis-grid">
          <div class="profile-insight-list">
            <div class="profile-insight-item"><span class="text-emerald-600"><i data-lucide="calendar-check" class="w-4 h-4"></i></span><p>${presencaTexto}</p></div>
            <div class="profile-insight-item"><span class="text-blue-600"><i data-lucide="heart-handshake" class="w-4 h-4"></i></span><p>${comportamentoTexto}</p></div>
            <div class="profile-insight-item"><span class="text-violet-600"><i data-lucide="notebook-tabs" class="w-4 h-4"></i></span><p>${atividadeTexto}</p></div>
            <div class="profile-insight-item"><span class="${aniversarioInfo?.hoje ? 'text-rose-600' : 'text-amber-600'}"><i data-lucide="cake" class="w-4 h-4"></i></span><p>${aniversarioTexto}</p></div>
          </div>
          <div class="profile-progress-panel">
            ${this.renderProgressRow('Presença geral', metricas.presencaPct, 'emerald')}
            ${this.renderProgressRow('Comportamento positivo', metricas.comportamentoPct, 'blue')}
            ${this.renderProgressRow('Documentação pedagógica', Math.min(metricas.atividades * 20, 100), 'violet')}
          </div>
        </div>
      `;
    }

    refreshIcons();
  },

  renderMetricCard(icon, label, value, hint, color = 'blue') {
    return `<article class="profile-metric-card metric-${color}">
      <div class="profile-metric-icon"><i data-lucide="${icon}" class="w-5 h-5"></i></div>
      <div>
        <p class="profile-metric-label">${escapeHTML(label)}</p>
        <p class="profile-metric-value">${escapeHTML(value)}</p>
        <p class="profile-metric-hint">${escapeHTML(hint)}</p>
      </div>
    </article>`;
  },

  renderProgressRow(label, value, color = 'blue') {
    const safeValue = Math.max(0, Math.min(Number(value) || 0, 100));
    return `<div class="profile-progress-row">
      <div class="flex items-center justify-between gap-3 mb-2">
        <span>${escapeHTML(label)}</span>
        <strong>${safeValue}%</strong>
      </div>
      <div class="profile-progress-track"><div class="profile-progress-fill fill-${color}" style="width:${safeValue}%"></div></div>
    </div>`;
  },

  preencherFormularioEdicaoAluno() {
    const s = this.data.students.find(s => String(s.id) === String(this.currentStudentProfileId));
    if (!s) return;

    const setValue = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value || '';
    };

    this.renderSchoolSelectors('edit', s.professora_id || this.currentTeacherProfile?.id || '', s.turma_id || '');

    setValue('edit-nome', s.name);
    setValue('edit-data-nascimento', s.birthDate);
    this.atualizarIdadeCalculada('edit');
    setValue('edit-professora', s.professora_id || this.currentTeacherProfile?.id || '');
    this.sincronizarSelectTurmasAluno('edit', s.turma_id || '');
    setValue('edit-mae', s.nome_mae);
    setValue('edit-pai', s.nome_pai);
    setValue('edit-contato1', s.contato_1);
    setValue('edit-contato2', s.contato_2);
    setValue('edit-endereco', s.endereco);
    setValue('edit-resp1', s.responsavel_1);
    setValue('edit-resp2', s.responsavel_2);
    setValue('edit-resp3', s.responsavel_3);
    setValue('edit-indicacoes', s.indicacoes);
  },

  toggleStudentEdit(forceOpen = null) {
    const modal = document.getElementById('modal-edit-student');
    const form = document.getElementById('profile-edit-form');
    if (!modal || !form) return;

    const shouldOpen = forceOpen === null ? modal.classList.contains('hidden-view') : Boolean(forceOpen);

    if (shouldOpen) {
      this.preencherFormularioEdicaoAluno();
      modal.classList.remove('hidden-view');
      lockBodyScroll();
      const first = document.getElementById('edit-nome');
      setTimeout(() => { if (first) first.focus(); }, 50);
    } else {
      modal.classList.add('hidden-view');
      unlockBodyScrollIfNoModal();
    }

    refreshIcons();
  },

  async saveStudentProfile() {
    if (this.isSaving) return;

    const s = this.data.students.find(s => String(s.id) === String(this.currentStudentProfileId));
    if (!s) {
      alert('Aluno não encontrado para edição.');
      return;
    }

    const getValue = id => normalizarTexto(document.getElementById(id)?.value);
    const nome = getValue('edit-nome');
    const dataNascimento = getValue('edit-data-nascimento');
    const idade = calcularIdadePorNascimento(dataNascimento);

    if (!nome || !dataNascimento) {
      alert('Nome e data de nascimento são obrigatórios.');
      return;
    }

    if (idade === null) {
      alert('Informe uma data de nascimento válida.');
      return;
    }

    const payload = {
      nome_aluno: nome,
      idade,
      data_nascimento: dataNascimento,
      nome_mae: getValue('edit-mae') || null,
      nome_pai: getValue('edit-pai') || null,
      contato_1: getValue('edit-contato1') || null,
      contato_2: getValue('edit-contato2') || null,
      endereco: getValue('edit-endereco') || null,
      responsavel_1: getValue('edit-resp1') || null,
      responsavel_2: getValue('edit-resp2') || null,
      responsavel_3: getValue('edit-resp3') || null,
      indicacoes: getValue('edit-indicacoes') || null,
      professora_id: valorOuNull(document.getElementById('edit-professora')?.value) || this.currentTeacherProfile?.id || null,
      turma_id: valorOuNull(document.getElementById('edit-turma')?.value)
    };

    const btn = document.getElementById('btn-save-profile');
    this.isSaving = true;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> A guardar...';
      refreshIcons();
    }

    try {
      await mutateDiretoDaAPI(
        'alunos',
        'PATCH',
        payload,
        `id=eq.${encodeURIComponent(this.currentStudentProfileId)}`
      );

      await this.refreshAfterWrite();
      this.toggleStudentEdit(false);
      this.renderProfileInfo();
      this.renderProfileLists();
    } catch (error) {
      mostrarErro(error, 'Atualização dos dados do aluno');
    } finally {
      this.isSaving = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="save" class="w-4 h-4"></i> Guardar alterações';
        refreshIcons();
      }
    }
  },

  async updateProfilePhoto(event) {
    const file = event?.target?.files?.[0];
    const student = this.data.students.find(s => String(s.id) === String(this.currentStudentProfileId));

    if (!file || !student) return;

    if (!file.type.startsWith('image/')) {
      alert('Selecione um ficheiro de imagem válido.');
      event.target.value = '';
      return;
    }

    const loadingOverlay = document.getElementById('profile-photo-loading');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');

    try {
      const reader = new FileReader();
      reader.onload = function(e) {
        const imgPreview = document.getElementById('profile-current-photo');
        if (imgPreview) imgPreview.src = e.target.result;
      };
      reader.readAsDataURL(file);

      const novaFotoUrl = await this.uploadAvatar(file);

      await mutateDiretoDaAPI(
        'alunos',
        'PATCH',
        { foto_url: novaFotoUrl },
        `id=eq.${encodeURIComponent(this.currentStudentProfileId)}`
      );

      await this.refreshAfterWrite();

      const atual = this.data.students.find(s => String(s.id) === String(this.currentStudentProfileId));
      const imgPreview = document.getElementById('profile-current-photo');
      if (imgPreview && atual) imgPreview.src = atual.photo;

      alert('Foto atualizada com sucesso.');
    } catch (error) {
      mostrarErro(error, 'Atualização da foto');
      await this.refreshAfterWrite().catch(() => {});
    } finally {
      if (loadingOverlay) loadingOverlay.classList.add('hidden');
      if (event?.target) event.target.value = '';
    }
  },

  renderProfileLists() {
    const s = this.data.students.find(s => String(s.id) === String(this.currentStudentProfileId));

    if (!s) {
      const countEl = document.getElementById('profile-medal-count');
      if (countEl) countEl.innerText = '0';
      return;
    }

    const achievements = Array.isArray(s.achievements) ? s.achievements : [];
    const activities = Array.isArray(s.activities) ? s.activities : [];

    const countEl = document.getElementById('profile-medal-count');
    if (countEl) countEl.innerText = achievements.length;

    const getFilterValue = id => normalizarTexto(document.getElementById(id)?.value || '');
    const filterByDate = (items, dateKey, startId, endId) => {
      const start = getFilterValue(startId);
      const end = getFilterValue(endId);
      return items.filter(item => {
        const date = String(item?.[dateKey] || '').substring(0, 10);
        if (start && date < start) return false;
        if (end && date > end) return false;
        return true;
      });
    };

    const countThisMonth = items => {
      const prefix = hojeISO().substring(0, 7);
      return items.filter(item => String(item.date || '').startsWith(prefix)).length;
    };

    const getMainType = items => {
      if (!items.length) return '-';
      const totals = {};
      items.forEach(item => {
        const key = item.tipo || parseActivityDescription(item.description).tipo || 'Registro';
        totals[key] = (totals[key] || 0) + 1;
      });
      return Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';
    };

    const extrairTipoAtividade = descricao => parseActivityDescription(descricao);

    const renderAchievementItem = (a, compact = false) => {
      const config = getAchievementConfig(a.tipo);
      return `<div class="${compact ? 'compact-record-item' : 'achievement-history-item'}">
        <div class="${compact ? 'compact-record-icon' : 'achievement-history-icon'} ${config.text}" aria-hidden="true">
          <i data-lucide="${config.lucide || 'award'}" class="w-5 h-5"></i>
        </div>
        <div class="flex-1 min-w-0 ${compact ? '' : 'pr-8'}">
          <div class="flex justify-between items-start gap-3 mb-1">
            <p class="font-bold text-[11px] uppercase tracking-wider ${config.text}">${escapeHTML(config.label)}</p>
            <p class="text-[10px] text-slate-400 font-semibold whitespace-nowrap">${escapeHTML(a.date)}</p>
          </div>
          <p class="text-sm text-slate-700 leading-snug break-words">${escapeHTML(a.descricao)}</p>
        </div>
        ${compact ? '' : `<button onclick="window.app.removeAchievement('${escapeAttr(a.id)}')" class="absolute right-3 top-3 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors touch-manipulation" aria-label="Remover prêmio"><i data-lucide="trash-2" class="w-4 h-4"></i></button>`}
      </div>`;
    };

    const renderActivityItem = (a, compact = false) => {
      const parsed = { tipo: a.tipo || extrairTipoAtividade(a.description).tipo, texto: a.description || extrairTipoAtividade(a.description).texto };
      const feita = a.feita === true;
      const statusLabel = feita ? 'Feita' : 'Não feita';
      const statusClass = feita ? 'activity-status-done' : 'activity-status-pending';
      return `<div class="${compact ? 'compact-record-item' : 'profile-activity-item'}">
        <span class="${compact ? 'compact-record-icon' : 'profile-activity-icon'} text-emerald-600"><i data-lucide="book-open" class="w-4 h-4"></i></span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2 mb-1">
            <span class="activity-kind-badge">${escapeHTML(parsed.tipo)}</span>
            <span class="activity-status-badge ${statusClass}">${statusLabel}</span>
            <p class="text-[11px] text-slate-400 font-bold">${escapeHTML(a.date)}</p>
          </div>
          <p class="text-sm text-slate-700 leading-snug break-words">${escapeHTML(parsed.texto)}</p>
          ${compact || !a.id ? '' : `<div class="mt-3 flex justify-end"><button type="button" onclick="window.app.toggleActivityDone('${escapeAttr(a.id)}', ${!feita})" class="activity-status-action"><i data-lucide="${feita ? 'rotate-ccw' : 'check-circle'}" class="w-4 h-4"></i>${feita ? 'Marcar não feita' : 'Marcar feita'}</button></div>`}
        </div>
      </div>`;
    };

    const achievementsPreview = document.getElementById('profile-achievements-preview');
    if (achievementsPreview) {
      achievementsPreview.innerHTML = achievements.length > 0
        ? achievements.slice(0, 3).map(a => renderAchievementItem(a, true)).join('')
        : '<div class="empty-compact-state">Nenhuma conquista registrada ainda.</div>';
    }

    const achievementsFiltradas = filterByDate(achievements, 'date', 'achievement-filter-start', 'achievement-filter-end');
    const modalAchievements = document.getElementById('modal-achievements-list-content');
    if (modalAchievements) {
      modalAchievements.innerHTML = achievementsFiltradas.length > 0
        ? achievementsFiltradas.map(a => renderAchievementItem(a, false)).join('')
        : '<div class="empty-compact-state">Nenhuma conquista encontrada para este filtro.</div>';
    }

    const achTotal = document.getElementById('modal-achievements-count');
    const achMonth = document.getElementById('modal-achievements-month-count');
    const achMain = document.getElementById('modal-achievements-main-type');
    const achFiltered = document.getElementById('modal-achievements-filtered-count');
    if (achTotal) achTotal.innerText = achievements.length;
    if (achMonth) achMonth.innerText = countThisMonth(achievements);
    if (achMain) achMain.innerText = getMainType(achievements).replace('Cooperativo', 'Cooperação').replace('Participativo', 'Participação');
    if (achFiltered) achFiltered.innerText = achievementsFiltradas.length;

    const activitiesPreview = document.getElementById('profile-activities-preview');
    if (activitiesPreview) {
      activitiesPreview.innerHTML = activities.length > 0
        ? activities.slice(0, 3).map(a => renderActivityItem(a, true)).join('')
        : '<div class="empty-compact-state">Nenhuma atividade registrada ainda.</div>';
    }

    const activitiesFiltradas = filterByDate(activities, 'date', 'activity-filter-start', 'activity-filter-end');
    const activitiesModalList = document.getElementById('modal-activities-history-list');
    if (activitiesModalList) {
      activitiesModalList.innerHTML = activitiesFiltradas.length > 0
        ? activitiesFiltradas.map(a => renderActivityItem(a, false)).join('')
        : '<div class="empty-compact-state">Nenhuma atividade encontrada para este filtro.</div>';
    }

    const activitiesCount = document.getElementById('modal-activities-count');
    const activitiesMonth = document.getElementById('modal-activities-month-count');
    const activitiesMain = document.getElementById('modal-activities-main-type');
    const activitiesFiltered = document.getElementById('modal-activities-filtered-count');
    if (activitiesCount) activitiesCount.innerText = activities.length;
    if (activitiesMonth) activitiesMonth.innerText = countThisMonth(activities);
    if (activitiesMain) activitiesMain.innerText = getMainType(activities);
    if (activitiesFiltered) activitiesFiltered.innerText = activitiesFiltradas.length;

    refreshIcons();
  },


  getParentLinkForStudent(alunoId) {
    const links = Array.isArray(this.currentParentProfile?.links) ? this.currentParentProfile.links : [];
    return links.find(link => String(link.aluno_id) === String(alunoId)) || null;
  },

  async saveParentProfileInfo() {
    if (this.isSaving) return;

    const responsavel = this.currentParentProfile;
    if (!responsavel?.id) {
      alert('Perfil do responsável não encontrado.');
      return;
    }

    const nome = normalizarTexto(document.getElementById('parent-onboarding-name')?.value);
    const telefone = normalizarTexto(document.getElementById('parent-onboarding-phone')?.value);
    const parentesco = normalizarTexto(document.getElementById('parent-onboarding-parentesco')?.value);
    const nomeFilho = normalizarTexto(document.getElementById('parent-child-full-name')?.value) || responsavel.aluno_nome_informado || '';
    const possuiFilhoVinculado = Array.isArray(responsavel.aluno_ids) && responsavel.aluno_ids.length > 0;

    if (!nome) {
      alert('Informe seu nome completo.');
      return;
    }

    try {
      const payload = {
        nome,
        telefone: telefone || null,
        parentesco_padrao: parentesco || null,
        onboarding_concluido: possuiFilhoVinculado ? true : false,
        cadastro_completo_em: new Date().toISOString()
      };

      // O nome do primeiro filho só é guardado no cadastro inicial.
      // Depois que houver vínculo, esse dado fica bloqueado e não é regravado.
      if (!possuiFilhoVinculado) {
        payload.aluno_nome_informado = nomeFilho || null;
      }

      await mutateDiretoDaAPI(
        'responsaveis',
        'PATCH',
        payload,
        `id=eq.${encodeURIComponent(responsavel.id)}`
      );

      await this.carregarPerfilResponsavel();
      this.renderParentView();
      alert('Dados do responsável guardados com sucesso.');
    } catch (err) {
      mostrarErro(err, 'Atualização do responsável');
    }
  },

  async linkParentByInviteCode() {
    if (this.isSaving) return;

    const responsavel = this.currentParentProfile;
    const codigo = (
      normalizarTexto(document.getElementById('parent-invite-code')?.value) ||
      normalizarTexto(document.getElementById('parent-add-child-code')?.value)
    ).toUpperCase();

    if (!responsavel?.id) {
      alert('Perfil do responsável não encontrado.');
      return;
    }

    if (!codigo) {
      alert('Informe o código enviado pela escola.');
      return;
    }

    this.isSaving = true;

    try {
      const convites = await fetchDiretoDaAPI(
        'convites_responsaveis',
        'id,codigo,aluno_id,turma_id,professora_id,email_destino,parentesco_sugerido,max_usos,usos,ativo,expira_em',
        `codigo=eq.${encodeURIComponent(codigo)}&ativo=eq.true&limit=1`
      );

      if (!Array.isArray(convites) || convites.length === 0) {
        throw new Error('Código não encontrado ou inativo.');
      }

      const convite = convites[0];
      if (!convite.aluno_id) {
        throw new Error('Este convite não está vinculado a um aluno.');
      }

      if (convite.expira_em && new Date(convite.expira_em) < new Date()) {
        throw new Error('Este código expirou. Peça um novo código à escola.');
      }

      if (Number(convite.usos || 0) >= Number(convite.max_usos || 1)) {
        throw new Error('Este código já foi utilizado.');
      }

      const linkExistente = await fetchDiretoDaAPI(
        'responsavel_alunos',
        'id,responsavel_id,aluno_id,ativo',
        `responsavel_id=eq.${encodeURIComponent(responsavel.id)}&aluno_id=eq.${encodeURIComponent(convite.aluno_id)}&limit=1`
      ).catch(() => []);

      if (Array.isArray(linkExistente) && linkExistente.length > 0) {
        await mutateDiretoDaAPI(
          'responsavel_alunos',
          'PATCH',
          { ativo: true, status_vinculo: 'ativo' },
          `id=eq.${encodeURIComponent(linkExistente[0].id)}`
        );
      } else {
        const parentesco = normalizarTexto(document.getElementById('parent-onboarding-parentesco')?.value) || convite.parentesco_sugerido || responsavel.parentesco_padrao || null;

        await mutateDiretoDaAPI('responsavel_alunos', 'POST', {
          responsavel_id: responsavel.id,
          aluno_id: convite.aluno_id,
          parentesco,
          ativo: true,
          status_vinculo: 'ativo',
          ficha_revisada: false,
          convite_id: convite.id
        });
      }

      await mutateDiretoDaAPI(
        'convites_responsaveis',
        'PATCH',
        {
          usos: Number(convite.usos || 0) + 1,
          usado_por_responsavel_id: responsavel.id,
          usado_em: new Date().toISOString()
        },
        `id=eq.${encodeURIComponent(convite.id)}`
      ).catch(() => {});

      await mutateDiretoDaAPI(
        'responsaveis',
        'PATCH',
        {
          aluno_nome_informado_bloqueado: true,
          primeiro_filho_vinculado_em: responsavel.primeiro_filho_vinculado_em || new Date().toISOString(),
          onboarding_concluido: true
        },
        `id=eq.${encodeURIComponent(responsavel.id)}`
      ).catch(() => {});

      await this.carregarPerfilResponsavel();
      await this.fetchStudents({ silent: true });
      await this.fetchParentClassmates({ silent: true });
      await this.fetchGalleryPhotos({ silent: true });
      this.activeChildId = convite.aluno_id || this.data.students[0]?.id || null;
      this.activeParentPanelTab = 'filhos';
      this.renderParentView();

      const inputNovo = document.getElementById('parent-add-child-code');
      if (inputNovo) inputNovo.value = '';

      alert('Filho vinculado com sucesso. Agora revise a ficha escolar uma única vez.');
    } catch (err) {
      mostrarErro(err, 'Vinculação do filho');
    } finally {
      this.isSaving = false;
    }
  },

  async linkAdditionalChildByInviteCode() {
    await this.linkParentByInviteCode();
  },


  async linkParentByStudentName() {
    if (this.isSaving) return;

    const nomeFilho = normalizarTexto(document.getElementById('parent-child-full-name')?.value);
    if (!nomeFilho) {
      alert('Informe o nome e sobrenome do filho.');
      return;
    }

    if (!contemNomeESobrenome(nomeFilho)) {
      alert('Informe nome e sobrenome do filho para localizar a ficha correta.');
      return;
    }

    this.isSaving = true;
    try {
      const match = await this.resolverFilhoConfirmadoParaCadastro(nomeFilho, 'onboarding');
      await this.linkParentByStudentIdInternal(match.id, { nomeFilho: match.name || nomeFilho, matchScore: match.score || 1 });
      await this.carregarPerfilResponsavel();
      await this.fetchStudents({ silent: true });
      await this.fetchParentClassmates({ silent: true });
      await this.fetchGalleryPhotos({ silent: true });
      this.activeChildId = match.id || this.data.students[0]?.id || null;
      this.renderParentView();
      alert('Ficha encontrada e vinculada com sucesso. Agora revise os dados do aluno.');
    } catch (err) {
      mostrarErro(err, 'Vinculação pelo nome do filho');
    } finally {
      this.isSaving = false;
    }
  },

  async linkParentByStudentNameInternal(nomeFilho, { silent = false } = {}) {
    const responsavel = this.currentParentProfile;
    const nomeNormalizado = normalizarNomeBusca(nomeFilho);

    if (!responsavel?.id) {
      throw new Error('Perfil do responsável não encontrado.');
    }

    if (!nomeNormalizado || !contemNomeESobrenome(nomeFilho)) {
      throw new Error('Informe nome e sobrenome do filho.');
    }

    // O nome do filho informado no cadastro inicial é usado uma única vez.
    // Depois do primeiro vínculo, novos filhos devem ser adicionados por código da escola.
    if (responsavel.aluno_ids?.length) {
      return responsavel.links?.[0] || null;
    }

    await mutateDiretoDaAPI(
      'responsaveis',
      'PATCH',
      { aluno_nome_informado: nomeFilho },
      `id=eq.${encodeURIComponent(responsavel.id)}`
    ).catch(() => {});

    const sugestoes = await this.buscarSugestoesFilhoPorNome(nomeFilho, { limit: 3 });
    const melhor = sugestoes[0];
    const segundo = sugestoes[1];

    if (!melhor) {
      throw new Error('Não encontramos uma ficha com esse nome completo. Confira nome e sobrenome ou peça um código à escola.');
    }

    const podeUsar = melhor.exact === true || (melhor.score >= 0.94 && (!segundo || (melhor.score - segundo.score) >= 0.16));
    if (!podeUsar) {
      throw new Error('Encontramos uma possível ficha, mas é necessário confirmar pela prévia com foto para evitar vínculo incorreto.');
    }

    const aluno = { id: melhor.id, nome_aluno: melhor.name, turma_id: melhor.turma_id, professora_id: melhor.professora_id };

    const vinculosExistentes = await fetchDiretoDaAPI(
      'responsavel_alunos',
      'id,responsavel_id,aluno_id,ativo',
      `responsavel_id=eq.${encodeURIComponent(responsavel.id)}&aluno_id=eq.${encodeURIComponent(aluno.id)}&limit=1`
    ).catch(() => []);

    if (Array.isArray(vinculosExistentes) && vinculosExistentes.length > 0) {
      const link = vinculosExistentes[0];
      if (link.ativo === false) {
        await mutateDiretoDaAPI(
          'responsavel_alunos',
          'PATCH',
          { ativo: true, status_vinculo: 'ativo' },
          `id=eq.${encodeURIComponent(link.id)}`
        );
      }

      await mutateDiretoDaAPI(
        'responsaveis',
        'PATCH',
        {
          aluno_nome_informado: aluno.nome_aluno || nomeFilho,
          aluno_id_informado: aluno.id,
          aluno_match_score: melhor?.score || 1,
          aluno_match_confirmado: true,
          aluno_nome_informado_bloqueado: true,
          primeiro_filho_vinculado_em: responsavel.primeiro_filho_vinculado_em || new Date().toISOString(),
          onboarding_concluido: true
        },
        `id=eq.${encodeURIComponent(responsavel.id)}`
      ).catch(() => {});

      return link;
    }

    const criado = await mutateDiretoDaAPI('responsavel_alunos', 'POST', {
      responsavel_id: responsavel.id,
      aluno_id: aluno.id,
      parentesco: responsavel.parentesco_padrao || null,
      ativo: true,
      status_vinculo: 'ativo',
      ficha_revisada: false,
      ficha_revisao_origem: 'vinculo_por_nome'
    });

    await mutateDiretoDaAPI(
      'responsaveis',
      'PATCH',
      {
        aluno_nome_informado: aluno.nome_aluno || nomeFilho,
        aluno_id_informado: aluno.id,
        aluno_match_score: melhor?.score || 1,
        aluno_match_confirmado: true,
        aluno_nome_informado_bloqueado: true,
        primeiro_filho_vinculado_em: responsavel.primeiro_filho_vinculado_em || new Date().toISOString(),
        onboarding_concluido: true
      },
      `id=eq.${encodeURIComponent(responsavel.id)}`
    ).catch(() => {});

    return Array.isArray(criado) && criado.length ? criado[0] : null;
  },

  async completeParentTutorial() {
    const responsavel = this.currentParentProfile;
    if (!responsavel?.id) {
      alert('Perfil do responsável não encontrado.');
      return;
    }

    try {
      await mutateDiretoDaAPI(
        'responsaveis',
        'PATCH',
        {
          tutorial_concluido: true,
          tutorial_concluido_em: new Date().toISOString()
        },
        `id=eq.${encodeURIComponent(responsavel.id)}`
      );

      await this.carregarPerfilResponsavel();
      this.activeParentPanelTab = 'filho';
      this.renderParentView();
    } catch (err) {
      mostrarErro(err, 'Conclusão do tutorial');
    }
  },

  async saveParentFichaReview(alunoId) {
    if (this.isSaving) return;

    const aluno = this.data.students.find(item => String(item.id) === String(alunoId));
    const link = this.getParentLinkForStudent(alunoId);

    if (!aluno || !link) {
      alert('Aluno ou vínculo não encontrado.');
      return;
    }

    if (link.ficha_revisada === true) {
      alert('Esta ficha já foi revisada e não pode ser alterada novamente pelo responsável.');
      return;
    }

    const getValue = id => normalizarTexto(document.getElementById(id)?.value);
    const nomeMae = getValue(`parent-review-mae-${alunoId}`);
    const nomePai = getValue(`parent-review-pai-${alunoId}`);
    const contato1 = getValue(`parent-review-contato1-${alunoId}`);
    const contato2 = getValue(`parent-review-contato2-${alunoId}`);
    const endereco = getValue(`parent-review-endereco-${alunoId}`);
    const responsavel1 = getValue(`parent-review-resp1-${alunoId}`);
    const responsavel2 = getValue(`parent-review-resp2-${alunoId}`);
    const responsavel3 = getValue(`parent-review-resp3-${alunoId}`);
    const indicacoes = getValue(`parent-review-indicacoes-${alunoId}`);

    if (!confirm('Confirmar revisão da ficha? Depois de guardar, ela ficará somente leitura para o responsável.')) return;

    this.isSaving = true;

    try {
      await mutateDiretoDaAPI(
        'alunos',
        'PATCH',
        {
          nome_mae: nomeMae || null,
          nome_pai: nomePai || null,
          contato_1: contato1 || null,
          contato_2: contato2 || null,
          endereco: endereco || null,
          responsavel_1: responsavel1 || null,
          responsavel_2: responsavel2 || null,
          responsavel_3: responsavel3 || null,
          indicacoes: indicacoes || null
        },
        `id=eq.${encodeURIComponent(alunoId)}`
      );

      await mutateDiretoDaAPI(
        'responsavel_alunos',
        'PATCH',
        {
          ficha_revisada: true,
          ficha_revisada_em: new Date().toISOString(),
          ficha_revisada_por: this.currentParentProfile.id,
          ficha_revisao_origem: 'portal_responsavel'
        },
        `id=eq.${encodeURIComponent(link.id)}`
      );

      await this.carregarPerfilResponsavel();
      await this.fetchStudents({ silent: true });
      await this.fetchParentClassmates({ silent: true });
      this.renderParentView();

      alert('Ficha revisada e guardada com sucesso. Agora veja o mini tutorial do portal.');
    } catch (err) {
      mostrarErro(err, 'Revisão da ficha');
    } finally {
      this.isSaving = false;
    }
  },


  setParentPanelTab(tab = 'inicio') {
    const aliases = { perfil: 'filho', galeria: 'fotos', conta: 'conta' };
    const normalized = aliases[tab] || tab;
    this.activeParentPanelTab = ['inicio', 'filho', 'fotos', 'colegas', 'filhos', 'conta'].includes(normalized) ? normalized : 'inicio';
    this.renderParentView();
  },

  setParentGalleryTab(tab = 'individual') {
    this.activeParentGalleryTab = ['individual', 'turma', 'eventos'].includes(tab) ? tab : 'individual';
    this.renderParentView();
  },

  async toggleGalleryLike(fotoId) {
    const responsavelId = this.currentParentProfile?.id;
    if (!responsavelId || !fotoId) return;

    const stats = this.getGalleryStats(fotoId);

    try {
      if (stats.likedByMe) {
        await mutateDiretoDaAPI(
          'foto_curtidas',
          'DELETE',
          null,
          `foto_id=eq.${encodeURIComponent(fotoId)}&responsavel_id=eq.${encodeURIComponent(responsavelId)}`,
          'return=minimal'
        );
      } else {
        await mutateDiretoDaAPI('foto_curtidas', 'POST', {
          foto_id: fotoId,
          responsavel_id: responsavelId
        });
      }

      await this.fetchGalleryInteractions({ silent: true });
      this.renderParentView();
    } catch (err) {
      mostrarErro(err, 'Curtida da foto');
    }
  },

  async toggleGallerySaved(fotoId) {
    const responsavelId = this.currentParentProfile?.id;
    if (!responsavelId || !fotoId) return;

    const stats = this.getGalleryStats(fotoId);

    try {
      if (stats.savedByMe) {
        await mutateDiretoDaAPI(
          'foto_salvos',
          'DELETE',
          null,
          `foto_id=eq.${encodeURIComponent(fotoId)}&responsavel_id=eq.${encodeURIComponent(responsavelId)}`,
          'return=minimal'
        );
      } else {
        await mutateDiretoDaAPI('foto_salvos', 'POST', {
          foto_id: fotoId,
          responsavel_id: responsavelId
        });
      }

      await this.fetchGalleryInteractions({ silent: true });
      this.renderParentView();
    } catch (err) {
      mostrarErro(err, 'Guardar foto');
    }
  },

  async addGalleryComment(fotoId) {
    const responsavelId = this.currentParentProfile?.id;
    if (!responsavelId || !fotoId) return;

    const comentario = normalizarTexto(prompt('Escreva um comentário para esta foto:'));
    if (!comentario) return;

    try {
      await mutateDiretoDaAPI('foto_comentarios', 'POST', {
        foto_id: fotoId,
        responsavel_id: responsavelId,
        comentario,
        ativo: true
      });

      await this.fetchGalleryInteractions({ silent: true });
      this.renderParentView();
    } catch (err) {
      mostrarErro(err, 'Comentário da foto');
    }
  },

  async shareGalleryPhoto(fotoId) {
    const foto = (this.data.galleryPhotos || []).find(item => String(item.id) === String(fotoId));
    if (!foto) return;

    const shareData = {
      title: foto.titulo || 'Foto escolar',
      text: foto.descricao || 'Veja este momento escolar.',
      url: foto.url
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(foto.url);
        alert('Link da foto copiado.');
      } else {
        prompt('Copie o link da foto:', foto.url);
      }

      if (this.currentParentProfile?.id) {
        await mutateDiretoDaAPI('foto_compartilhamentos', 'POST', {
          foto_id: fotoId,
          responsavel_id: this.currentParentProfile.id,
          canal: navigator.share ? 'web_share' : 'clipboard'
        }).catch(() => {});
      }
    } catch (err) {
      if (err?.name !== 'AbortError') mostrarErro(err, 'Compartilhamento da foto');
    }
  },

  renderParentOnboarding() {
    const responsavel = this.currentParentProfile || {};
    const nomeFilho = responsavel.aluno_nome_informado || '';
    return `
      <div class="parent-v30 parent-v30-flow">
        <section class="parent-v30-flow-hero">
          <span class="parent-v30-chip"><i data-lucide="heart-handshake" class="w-4 h-4"></i> Primeiro acesso da família</span>
          <h2>Vamos criar seu acesso escolar com segurança.</h2>
          <p>Complete seus dados, encontre a ficha do seu filho pela busca inteligente e confirme a prévia com foto. Depois você revisa a ficha e conhece o portal.</p>
          <div class="parent-v30-stepper">
            <span class="is-current"><b>1</b> Cadastro</span>
            <span><b>2</b> Ficha</span>
            <span><b>3</b> Tutorial</span>
            <span><b>4</b> Portal</span>
          </div>
        </section>

        <section class="parent-v30-onboarding-grid">
          <article class="parent-v30-card parent-v30-form-card">
            <div class="parent-v30-section-head">
              <span><i data-lucide="user-round-cog" class="w-5 h-5"></i></span>
              <div>
                <p>Dados do responsável</p>
                <h3>Seu perfil de acesso</h3>
              </div>
            </div>

            <div class="parent-v30-form-grid">
              <label>
                <span>Nome completo</span>
                <input id="parent-onboarding-name" class="app-input" value="${escapeAttr(responsavel.nome || '')}" placeholder="Seu nome completo">
              </label>
              <label>
                <span>Telefone</span>
                <input id="parent-onboarding-phone" class="app-input" value="${escapeAttr(responsavel.telefone || '')}" placeholder="Contacto/WhatsApp">
              </label>
              <label>
                <span>Parentesco</span>
                <input id="parent-onboarding-parentesco" class="app-input" value="${escapeAttr(responsavel.parentesco_padrao || '')}" placeholder="Mãe, pai, avó...">
              </label>
              <label>
                <span>Email</span>
                <div class="parent-v30-readonly">${escapeHTML(responsavel.email || 'Email não informado')}</div>
              </label>
            </div>
          </article>

          <article class="parent-v30-card parent-v30-form-card">
            <div class="parent-v30-section-head">
              <span><i data-lucide="scan-search" class="w-5 h-5"></i></span>
              <div>
                <p>Vincular filho</p>
                <h3>Busca inteligente pela ficha</h3>
              </div>
            </div>

            <p class="parent-v30-help">Digite nome e sobrenome. A busca reconhece pequenas diferenças, nomes sem acento e mostra a prévia com foto para você confirmar com segurança.</p>

            <label class="parent-v30-field">
              <span>Nome e sobrenome do filho(a)</span>
              <input
                id="parent-child-full-name"
                class="app-input"
                value="${escapeAttr(nomeFilho)}"
                placeholder="Ex: Lucas Silva"
                autocomplete="off"
                oninput="window.app.handleParentChildNameInput('onboarding')"
                onblur="window.app.handleParentChildNameInput('onboarding', { immediate: true })"
                ${responsavel.aluno_nome_informado_bloqueado ? 'readonly' : ''}
              >
            </label>

            <div id="parent-child-name-preview" class="parent-child-match-slot"></div>

            <div class="parent-v30-note">
              <i data-lucide="shield-check" class="w-4 h-4"></i>
              <span>Após o primeiro vínculo, este filho fica bloqueado. Outros filhos poderão ser adicionados depois com código enviado pela escola.</span>
            </div>

            <button type="button" onclick="window.app.completeParentFirstStep()" class="parent-v30-primary">
              <i data-lucide="arrow-right-circle" class="w-4 h-4"></i> Confirmar cadastro e seguir para a ficha
            </button>

            <details class="parent-v30-details">
              <summary><i data-lucide="key-round" class="w-4 h-4"></i> Tenho um código enviado pela escola</summary>
              <div>
                <input id="parent-invite-code" class="app-input text-center uppercase tracking-[0.25em] font-black" placeholder="ABCD-1234">
                <button type="button" onclick="window.app.linkParentByInviteCode()" class="btn-soft w-full">
                  Usar código de vínculo
                </button>
              </div>
            </details>
          </article>
        </section>
      </div>
    `;
  },

  renderParentFichaReview(s, link) {
    const readonly = link?.ficha_revisada === true;
    const alunoId = s.id;
    const disabledAttr = readonly ? 'disabled' : '';
    return `
      <section class="parent-social-card parent-review-card">
        <div class="parent-social-section-head">
          <span><i data-lucide="${readonly ? 'shield-check' : 'clipboard-pen'}" class="w-5 h-5"></i></span>
          <div>
            <p class="profile-eyebrow">${readonly ? 'Ficha revisada' : 'Revisão necessária'}</p>
            <h3>${readonly ? 'Ficha escolar em modo consulta' : 'Revise a ficha do aluno para avançar'}</h3>
          </div>
        </div>
        <p class="text-sm text-slate-500 mt-3">${readonly ? `Revisada em ${escapeHTML(formatarDataBR(link.ficha_revisada_em))}. A professora continua responsável pelas próximas alterações.` : 'Confira os dados abaixo com atenção. Ao guardar, você seguirá para um mini tutorial e esta ficha ficará somente leitura para o responsável.'}</p>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <div>
            <label class="app-label">Nome da mãe</label>
            <input id="parent-review-mae-${escapeAttr(alunoId)}" class="app-input" value="${escapeAttr(s.nome_mae)}" ${disabledAttr}>
          </div>
          <div>
            <label class="app-label">Nome do pai</label>
            <input id="parent-review-pai-${escapeAttr(alunoId)}" class="app-input" value="${escapeAttr(s.nome_pai)}" ${disabledAttr}>
          </div>
          <div>
            <label class="app-label">Contacto principal</label>
            <input id="parent-review-contato1-${escapeAttr(alunoId)}" class="app-input" value="${escapeAttr(s.contato_1)}" ${disabledAttr}>
          </div>
          <div>
            <label class="app-label">Contacto alternativo</label>
            <input id="parent-review-contato2-${escapeAttr(alunoId)}" class="app-input" value="${escapeAttr(s.contato_2)}" ${disabledAttr}>
          </div>
          <div class="md:col-span-2">
            <label class="app-label">Morada</label>
            <input id="parent-review-endereco-${escapeAttr(alunoId)}" class="app-input" value="${escapeAttr(s.endereco)}" ${disabledAttr}>
          </div>
          <div>
            <label class="app-label">Autorizado 1</label>
            <input id="parent-review-resp1-${escapeAttr(alunoId)}" class="app-input" value="${escapeAttr(s.responsavel_1)}" ${disabledAttr}>
          </div>
          <div>
            <label class="app-label">Autorizado 2</label>
            <input id="parent-review-resp2-${escapeAttr(alunoId)}" class="app-input" value="${escapeAttr(s.responsavel_2)}" ${disabledAttr}>
          </div>
          <div class="md:col-span-2">
            <label class="app-label">Autorizado 3</label>
            <input id="parent-review-resp3-${escapeAttr(alunoId)}" class="app-input" value="${escapeAttr(s.responsavel_3)}" ${disabledAttr}>
          </div>
          <div class="md:col-span-2">
            <label class="app-label">Indicações importantes / saúde</label>
            <textarea id="parent-review-indicacoes-${escapeAttr(alunoId)}" rows="4" class="app-input" ${disabledAttr}>${escapeHTML(s.indicacoes)}</textarea>
          </div>
        </div>

        ${readonly ? '' : `
          <button type="button" onclick="window.app.saveParentFichaReview('${escapeAttr(alunoId)}')" class="btn-primary-clean mt-5 w-full">
            <i data-lucide="check-circle" class="w-4 h-4"></i> Guardar ficha e ir para o próximo passo
          </button>
        `}
      </section>
    `;
  },


  renderParentFichaStepPage(s, link) {
    return `
      <div class="parent-social-layout parent-flow-page">
        <section class="parent-onboarding-hero parent-social-card parent-flow-hero">
          <span class="parent-social-badge"><i data-lucide="clipboard-pen" class="w-4 h-4"></i> Primeiro acesso</span>
          <h2>Revise a ficha de ${escapeHTML(s.name)}.</h2>
          <p>Esta revisão acontece apenas uma vez no portal da família. Depois, a ficha fica em modo consulta e a professora continua responsável por alterações futuras.</p>
          <div class="parent-flow-steps">
            <span class="is-done">1. Cadastro</span>
            <span class="is-current">2. Revisão da ficha</span>
            <span>3. Tutorial</span>
            <span>4. Perfil oficial</span>
          </div>
        </section>
        ${this.renderParentFichaReview(s, link)}
      </div>
    `;
  },

  renderParentTutorialPage(s) {
    return `
      <div class="parent-social-layout parent-flow-page">
        <section class="parent-onboarding-hero parent-social-card parent-flow-hero">
          <span class="parent-social-badge"><i data-lucide="graduation-cap" class="w-4 h-4"></i> Mini tutorial</span>
          <h2>Conheça o portal escolar de ${escapeHTML(s.name)}.</h2>
          <p>Leia este resumo rápido para acompanhar presença, conquistas, atividades, fotos e comunicados de forma simples.</p>
          <div class="parent-flow-steps">
            <span class="is-done">1. Cadastro</span>
            <span class="is-done">2. Revisão da ficha</span>
            <span class="is-current">3. Tutorial</span>
            <span>4. Perfil oficial</span>
          </div>
        </section>

        <section class="parent-social-card parent-tutorial-card-wrap">
          <div class="parent-social-section-head">
            <span><i data-lucide="map" class="w-5 h-5"></i></span>
            <div>
              <p class="profile-eyebrow">Como usar</p>
              <h3>O que você encontra no portal</h3>
            </div>
          </div>

          <div class="parent-tutorial-grid">
            <article class="parent-tutorial-card">
              <span><i data-lucide="user-round" class="w-5 h-5"></i></span>
              <strong>Perfil do aluno</strong>
              <p>Veja idade, turma, professora, aniversário, presença e indicadores escolares importantes.</p>
            </article>
            <article class="parent-tutorial-card">
              <span><i data-lucide="calendar-check" class="w-5 h-5"></i></span>
              <strong>Presença e rotina</strong>
              <p>Acompanhe registros de presença e faltas lançados pela professora.</p>
            </article>
            <article class="parent-tutorial-card">
              <span><i data-lucide="trophy" class="w-5 h-5"></i></span>
              <strong>Conquistas</strong>
              <p>Receba destaques positivos, ocorrências e evolução comportamental do seu filho.</p>
            </article>
            <article class="parent-tutorial-card">
              <span><i data-lucide="book-open-check" class="w-5 h-5"></i></span>
              <strong>Atividades</strong>
              <p>Confira atividades de classe, casa, leitura, participação e observações pedagógicas.</p>
            </article>
            <article class="parent-tutorial-card">
              <span><i data-lucide="images" class="w-5 h-5"></i></span>
              <strong>Galeria escolar</strong>
              <p>Veja fotos individuais, fotos da turma e eventos publicados pela escola em tempo real.</p>
            </article>
            <article class="parent-tutorial-card">
              <span><i data-lucide="heart" class="w-5 h-5"></i></span>
              <strong>Interação</strong>
              <p>Curta, comente, guarde e compartilhe os momentos escolares publicados.</p>
            </article>
          </div>

          <button type="button" onclick="window.app.completeParentTutorial()" class="btn-primary-clean mt-6 w-full">
            <i data-lucide="sparkles" class="w-4 h-4"></i> Entendi, seguir para o perfil oficial
          </button>
        </section>
      </div>
    `;
  },

  renderParentClassmates(s) {
    const turmaId = s?.turma_id || '';
    const colegas = (this.data.parentClassmates || []).filter(item => String(item.turma_id || '') === String(turmaId));

    return `
      <section class="parent-social-card parent-classmates-card">
        <div class="parent-social-section-head">
          <span><i data-lucide="users-round" class="w-5 h-5"></i></span>
          <div>
            <p class="profile-eyebrow">Coleguinhas de sala</p>
            <h3>${s.turma_nome ? escapeHTML(s.turma_nome) : 'Turma do aluno'}</h3>
          </div>
        </div>
        <p class="text-sm text-slate-500 mt-3">Lista simples dos colegas da mesma turma, com apenas nome, foto e idade.</p>
        ${colegas.length ? `
          <div class="parent-classmates-grid">
            ${colegas.map(colega => `
              <article class="parent-classmate-card ${String(colega.id) === String(s.id) ? 'is-own-child' : ''}">
                <img src="${escapeAttr(safeUrl(colega.photo) || criarAvatarPadrao(colega.name))}" alt="${escapeAttr(colega.name)}">
                <div>
                  <strong>${escapeHTML(colega.name)}</strong>
                  <span>${escapeHTML(formatarIdadeCalculada(Number.isInteger(Number(colega.age)) ? Number(colega.age) : null))}</span>
                </div>
              </article>
            `).join('')}
          </div>
        ` : `<div class="empty-compact-state mt-4">A lista de coleguinhas ainda não está disponível.</div>`}
      </section>
    `;
  },

  renderParentGalleryPhoto(foto) {
    const tipo = foto.tipo_foto || foto.tipo || 'turma';
    const stats = this.getGalleryStats(foto.id);
    const commentsPreview = stats.comments.slice(-2);
    const tagLabel =
      tipo === 'individual' || tipo === 'aluno' ? 'Individual' :
      tipo === 'evento' ? 'Evento' :
      tipo === 'geral' ? 'Geral' :
      'Turma';
    const tagClass =
      tipo === 'individual' || tipo === 'aluno' ? 'gallery-tag-individual' :
      tipo === 'evento' ? 'gallery-tag-event' :
      tipo === 'geral' ? 'gallery-tag-general' :
      'gallery-tag-class';

    return `
      <article class="parent-social-photo-card">
        <div class="parent-social-photo-media">
          <img src="${escapeAttr(foto.url)}" alt="${escapeAttr(foto.titulo)}">
          <span class="${tagClass}">${escapeHTML(tagLabel)}</span>
        </div>
        <div class="parent-social-photo-body">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h4>${escapeHTML(foto.titulo)}</h4>
              <p>${foto.descricao ? escapeHTML(foto.descricao) : 'Momento publicado pela escola.'}</p>
            </div>
            <small>${escapeHTML(formatarDataBR(foto.created_at))}</small>
          </div>

          <div class="parent-social-photo-actions">
            <button type="button" onclick="window.app.toggleGalleryLike('${escapeAttr(foto.id)}')" class="${stats.likedByMe ? 'is-active' : ''}">
              <i data-lucide="heart" class="w-4 h-4"></i> ${stats.likesCount}
            </button>
            <button type="button" onclick="window.app.addGalleryComment('${escapeAttr(foto.id)}')">
              <i data-lucide="message-circle" class="w-4 h-4"></i> ${stats.commentsCount}
            </button>
            <button type="button" onclick="window.app.toggleGallerySaved('${escapeAttr(foto.id)}')" class="${stats.savedByMe ? 'is-saved' : ''}">
              <i data-lucide="bookmark" class="w-4 h-4"></i> Guardar
            </button>
            <button type="button" onclick="window.app.shareGalleryPhoto('${escapeAttr(foto.id)}')">
              <i data-lucide="share-2" class="w-4 h-4"></i> Partilhar
            </button>
          </div>

          ${commentsPreview.length ? `
            <div class="parent-social-comments">
              ${commentsPreview.map(comment => `<p><strong>Família</strong> ${escapeHTML(comment.comentario)}</p>`).join('')}
            </div>
          ` : ''}
        </div>
      </article>
    `;
  },

  setActiveParentChild(childId, tab = 'filho') {
    if (!childId) return;
    this.activeChildId = childId;
    this.setParentPanelTab(tab || 'filho');
  },

  async requestParentPasswordReset() {
    const email = this.currentParentProfile?.email || this.authUser?.email || '';
    if (!email) {
      alert('Não encontrei o email da conta para enviar a recuperação de senha.');
      return;
    }

    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
      });
      if (error) throw error;
      alert('Enviei um email para troca de senha. Verifique sua caixa de entrada.');
    } catch (err) {
      mostrarErro(err, 'Troca de senha');
    }
  },

  contactTeacherFromParent() {
    const aluno = this.data.students.find(student => String(student.id) === String(this.activeChildId)) || this.data.students[0];
    const professora = this.data.professoras.find(p => String(p.id) === String(aluno?.professora_id || ''));
    const email = professora?.email || '';
    const nomeAluno = aluno?.name || 'meu filho';
    if (email) {
      window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Portal da Família - ' + nomeAluno)}&body=${encodeURIComponent('Olá, gostaria de falar sobre ' + nomeAluno + '.')}`;
    } else {
      alert('O email da professora ainda não está cadastrado. Entre em contato com a escola para atualizar este canal.');
    }
  },

  openParentSupport() {
    alert('Suporte do Portal da Família\\n\\nEm breve teremos um chat dentro do app. Por enquanto, fale com a escola ou use o botão “Falar com a professora”.');
  },


  buildParentChildDocument(kind = 'ficha') {
    const student = this.data.students.find(item => String(item.id) === String(this.activeChildId)) || this.data.students[0];
    if (!student) {
      return {
        title: 'Ficha escolar',
        subtitle: 'Nenhum aluno selecionado',
        html: '<div class="parent-doc-empty">Nenhum aluno encontrado para gerar o documento.</div>',
        shareText: 'Ficha escolar indisponível.'
      };
    }

    const metricas = calcularMetricasAluno(student);
    const idadeTexto = formatarIdadeCalculada(Number.isInteger(Number(student.age)) ? Number(student.age) : null);
    const professoraTexto = formatarNomeProfessora(student.professora_nome) || 'Tia não informada';
    const nascimentoTexto = student.birthDate ? formatarDataBR(student.birthDate) : 'Não informado';
    const aniversarioInfo = obterProximoAniversarioInfo(student.birthDate);
    const linkAtual = this.getParentLinkForStudent(student.id) || {};
    const rotina = this.data.routine || {};
    const chamadas = Object.entries(student.attendance || {})
      .filter(([, status]) => !!status)
      .sort(([a], [b]) => String(b).localeCompare(String(a)));
    const conquistas = Array.isArray(student.achievements) ? student.achievements : [];
    const atividades = Array.isArray(student.activities) ? student.activities : [];

    const tipoConfig = {
      ficha: {
        title: 'Ficha escolar completa',
        subtitle: 'Documento familiar com dados cadastrais, escola, responsáveis e observações importantes.',
        icon: 'id-card'
      },
      responsaveis: {
        title: 'Responsáveis e autorizações',
        subtitle: 'Contactos, morada, pessoas autorizadas e indicações relevantes.',
        icon: 'users-round'
      },
      presenca: {
        title: 'Presença e acompanhamento',
        subtitle: 'Resumo de chamadas, presenças, faltas, atividades e conquistas.',
        icon: 'calendar-check'
      },
      rotina: {
        title: 'Rotina escolar',
        subtitle: 'Organização semanal da escola e informações principais do aluno.',
        icon: 'calendar-days'
      }
    }[kind] || {
      title: 'Ficha escolar completa',
      subtitle: 'Documento familiar do aluno.',
      icon: 'id-card'
    };

    const infoBlocks = {
      aluno: `
        <section class="parent-doc-section">
          <h3><i data-lucide="user-round" class="w-5 h-5"></i> Identificação do aluno</h3>
          <div class="parent-doc-grid">
            <div><span>Nome completo</span><strong>${escapeHTML(student.name)}</strong></div>
            <div><span>Idade</span><strong>${escapeHTML(idadeTexto)}</strong></div>
            <div><span>Data de nascimento</span><strong>${escapeHTML(nascimentoTexto)}</strong></div>
            <div><span>Próximo aniversário</span><strong>${escapeHTML(aniversarioInfo ? (aniversarioInfo.hoje ? 'Hoje' : aniversarioInfo.label) : 'Não informado')}</strong></div>
          </div>
        </section>
      `,
      escola: `
        <section class="parent-doc-section">
          <h3><i data-lucide="school" class="w-5 h-5"></i> Informações escolares</h3>
          <div class="parent-doc-grid">
            <div><span>Turma</span><strong>${escapeHTML(student.turma_nome || 'Não informada')}</strong></div>
            <div><span>Professora</span><strong>${escapeHTML(professoraTexto)}</strong></div>
            <div><span>Status da ficha</span><strong>${linkAtual.ficha_revisada ? 'Revisada pela família' : 'Pendente de revisão'}</strong></div>
            <div><span>Data da emissão</span><strong>${escapeHTML(formatarDataBR(hojeISO()))}</strong></div>
          </div>
        </section>
      `,
      responsaveis: `
        <section class="parent-doc-section">
          <h3><i data-lucide="heart-handshake" class="w-5 h-5"></i> Responsáveis e contactos</h3>
          <div class="parent-doc-grid">
            <div><span>Mãe</span><strong>${escapeHTML(student.nome_mae || 'Não informado')}</strong></div>
            <div><span>Pai</span><strong>${escapeHTML(student.nome_pai || 'Não informado')}</strong></div>
            <div><span>Contacto 1</span><strong>${escapeHTML(student.contato_1 || 'Não informado')}</strong></div>
            <div><span>Contacto 2</span><strong>${escapeHTML(student.contato_2 || 'Não informado')}</strong></div>
            <div class="is-wide"><span>Morada</span><strong>${escapeHTML(student.endereco || 'Não informada')}</strong></div>
          </div>
        </section>
      `,
      autorizacoes: `
        <section class="parent-doc-section">
          <h3><i data-lucide="shield-check" class="w-5 h-5"></i> Autorizações e saúde</h3>
          <div class="parent-doc-grid">
            <div><span>Autorizado 1</span><strong>${escapeHTML(student.responsavel_1 || 'Não informado')}</strong></div>
            <div><span>Autorizado 2</span><strong>${escapeHTML(student.responsavel_2 || 'Não informado')}</strong></div>
            <div><span>Autorizado 3</span><strong>${escapeHTML(student.responsavel_3 || 'Não informado')}</strong></div>
            <div class="is-wide"><span>Indicações importantes</span><strong>${escapeHTML(student.indicacoes || 'Sem observações')}</strong></div>
          </div>
        </section>
      `,
      presenca: `
        <section class="parent-doc-section">
          <h3><i data-lucide="calendar-check" class="w-5 h-5"></i> Presença e indicadores</h3>
          <div class="parent-doc-metrics">
            <div><span>Presença geral</span><strong>${metricas.presencaPct}%</strong><small>${escapeHTML(metricas.presencaNivel)}</small></div>
            <div><span>Presenças</span><strong>${metricas.presencas}</strong><small>registros</small></div>
            <div><span>Faltas</span><strong>${metricas.faltas}</strong><small>registros</small></div>
            <div><span>Chamadas</span><strong>${metricas.totalChamadas}</strong><small>total</small></div>
          </div>
          <div class="parent-doc-list">
            ${chamadas.length ? chamadas.slice(0, 18).map(([data, status]) => `
              <div>
                <span>${escapeHTML(formatarDataBR(data))}</span>
                <strong class="${status === 'presente' ? 'is-green' : status === 'ausente' ? 'is-red' : 'is-yellow'}">${escapeHTML(status === 'presente' ? 'Presente' : status === 'ausente' ? 'Falta' : status)}</strong>
              </div>
            `).join('') : '<div><span>Nenhuma chamada registrada</span><strong class="is-yellow">Aguardando</strong></div>'}
          </div>
        </section>
      `,
      rotina: `
        <section class="parent-doc-section">
          <h3><i data-lucide="calendar-days" class="w-5 h-5"></i> Rotina semanal</h3>
          <div class="parent-doc-routine">
            ${Object.entries(rotina).map(([dia, texto]) => `
              <div>
                <strong>${escapeHTML(dia)}</strong>
                <span>${escapeHTML(texto || 'Sem rotina cadastrada.')}</span>
              </div>
            `).join('')}
          </div>
        </section>
      `,
      pedagogico: `
        <section class="parent-doc-section">
          <h3><i data-lucide="sparkles" class="w-5 h-5"></i> Registros pedagógicos</h3>
          <div class="parent-doc-metrics">
            <div><span>Conquistas</span><strong>${conquistas.length}</strong><small>${metricas.ocorrencias} ocorrência(s)</small></div>
            <div><span>Atividades</span><strong>${atividades.length}</strong><small>${escapeHTML(metricas.atividadeNivel)}</small></div>
            <div><span>Comportamento</span><strong>${metricas.comportamentoPct}%</strong><small>${escapeHTML(metricas.comportamentoNivel)}</small></div>
          </div>
          <div class="parent-doc-list">
            ${conquistas.slice(0, 8).map(item => {
              const config = getAchievementConfig(item.tipo);
              return `<div><span>${escapeHTML(config.label || item.tipo || 'Conquista')} · ${escapeHTML(formatarDataBR(item.date))}</span><strong>${escapeHTML(item.descricao || 'Registro escolar')}</strong></div>`;
            }).join('') || '<div><span>Conquistas</span><strong>Ainda sem registros</strong></div>'}
            ${atividades.slice(0, 6).map(item => `<div><span>${escapeHTML(item.tipo || 'Atividade')} · ${escapeHTML(formatarDataBR(item.date))}</span><strong>${escapeHTML(item.description || 'Atividade registrada')}</strong></div>`).join('')}
          </div>
        </section>
      `
    };

    let body = '';
    if (kind === 'responsaveis') body = infoBlocks.responsaveis + infoBlocks.autorizacoes;
    else if (kind === 'presenca') body = infoBlocks.presenca + infoBlocks.pedagogico;
    else if (kind === 'rotina') body = infoBlocks.rotina + infoBlocks.escola;
    else body = infoBlocks.aluno + infoBlocks.escola + infoBlocks.responsaveis + infoBlocks.autorizacoes + infoBlocks.presenca + infoBlocks.rotina;

    const html = `
      <div class="parent-doc-paper">
        <header class="parent-doc-paper-head">
          <div>
            <span><i data-lucide="${tipoConfig.icon}" class="w-6 h-6"></i></span>
            <div>
              <small>Portal da Família · ERP Escolar</small>
              <h1>${escapeHTML(tipoConfig.title)}</h1>
              <p>${escapeHTML(tipoConfig.subtitle)}</p>
            </div>
          </div>
          <img src="${escapeAttr(safeUrl(student.photo) || criarAvatarPadrao(student.name))}" alt="${escapeAttr(student.name)}">
        </header>

        <section class="parent-doc-student-line">
          <strong>${escapeHTML(student.name)}</strong>
          <span>${escapeHTML(idadeTexto)} · ${escapeHTML(student.turma_nome || 'Turma não informada')} · ${escapeHTML(professoraTexto)}</span>
        </section>

        ${body}

        <footer class="parent-doc-footer">
          <span>Documento gerado pelo Portal da Família em ${escapeHTML(formatarDataBR(hojeISO()))}.</span>
          <strong>Uso escolar e familiar.</strong>
        </footer>
      </div>
    `;

    const shareText = `${tipoConfig.title}\nAluno(a): ${student.name}\nTurma: ${student.turma_nome || 'Não informada'}\nProfessora: ${professoraTexto}\nEmitido em: ${formatarDataBR(hojeISO())}`;

    return {
      title: tipoConfig.title,
      subtitle: tipoConfig.subtitle,
      html,
      shareText
    };
  },

  openParentChildDocument(kind = 'ficha') {
    const existing = document.getElementById('parent-document-page');
    if (existing) existing.remove();

    const doc = this.buildParentChildDocument(kind);
    this.currentParentDocumentKind = kind;
    this.currentParentDocumentShareText = doc.shareText;

    const modal = document.createElement('div');
    modal.id = 'parent-document-page';
    modal.className = 'parent-doc-modal animate-fade-in';
    modal.setAttribute('data-document-kind', kind);
    modal.innerHTML = `
      <div class="parent-doc-topbar">
        <button type="button" onclick="window.app.closeParentChildDocument()" class="parent-doc-back">
          <i data-lucide="arrow-left" class="w-5 h-5"></i>
          <span>Voltar</span>
        </button>
        <div>
          <strong>${escapeHTML(doc.title)}</strong>
          <small>${escapeHTML(doc.subtitle)}</small>
        </div>
        <div class="parent-doc-actions">
          <button type="button" onclick="window.app.shareParentChildDocument()">
            <i data-lucide="share-2" class="w-4 h-4"></i>
            <span>Compartilhar</span>
          </button>
          <button type="button" onclick="window.app.printParentChildDocument()">
            <i data-lucide="printer" class="w-4 h-4"></i>
            <span>PDF</span>
          </button>
        </div>
      </div>
      <main class="parent-doc-scroll">
        ${doc.html}
      </main>
    `;

    document.body.appendChild(modal);
    document.body.classList.add('overflow-hidden');
    refreshIcons();
  },

  closeParentChildDocument() {
    const modal = document.getElementById('parent-document-page');
    if (modal) modal.remove();
    document.body.classList.remove('overflow-hidden');
    refreshIcons();
  },

  async shareParentChildDocument() {
    const texto = this.currentParentDocumentShareText || this.buildParentChildDocument(this.currentParentDocumentKind || 'ficha').shareText;

    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Ficha escolar',
          text: texto
        });
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto);
        alert('Resumo copiado para a área de transferência.');
        return;
      }

      alert(texto);
    } catch (err) {
      if (err?.name !== 'AbortError') mostrarErro(err, 'Compartilhamento da ficha');
    }
  },

  printParentChildDocument() {
    window.print();
  },

  renderParentView() {
    const container = document.getElementById('parent-content');
    if (!container) return;

    if (!this.currentParentProfile) {
      container.innerHTML = `
        <section class="parent-v30 parent-v30-empty">
          <i data-lucide="user-round-x" class="w-7 h-7"></i>
          <strong>Sessão do responsável não encontrada.</strong>
          <span>Entre novamente para continuar.</span>
        </section>
      `;
      refreshIcons();
      return;
    }

    if (!Array.isArray(this.data.students) || this.data.students.length === 0) {
      container.innerHTML = this.renderParentOnboarding();
      refreshIcons();
      return;
    }

    let s = this.data.students.find(student => String(student.id) === String(this.activeChildId));
    if (!s) {
      s = this.data.students[0];
      this.activeChildId = s.id;
    }

    const link = this.getParentLinkForStudent(s.id);

    if (link && link.ficha_revisada !== true) {
      container.innerHTML = this.renderParentFichaStepPage(s, link);
      refreshIcons();
      return;
    }

    if (!this.currentParentProfile.tutorial_concluido) {
      container.innerHTML = this.renderParentTutorialPage(s);
      refreshIcons();
      return;
    }

    const responsavel = this.currentParentProfile || {};
    const tabAtualRaw = this.activeParentPanelTab || 'inicio';
    const tabAtual = tabAtualRaw === 'perfil' ? 'filho' : (['inicio', 'filho', 'fotos', 'colegas', 'filhos', 'conta'].includes(tabAtualRaw) ? tabAtualRaw : 'inicio');
    this.activeParentPanelTab = tabAtual;

    const metricas = calcularMetricasAluno(s);
    const conquistas = Array.isArray(s.achievements) ? s.achievements : [];
    const atividades = Array.isArray(s.activities) ? s.activities : [];
    const aniversarioInfo = obterProximoAniversarioInfo(s.birthDate);
    const idadeTexto = formatarIdadeCalculada(Number.isInteger(Number(s.age)) ? Number(s.age) : null);
    const professoraTexto = formatarNomeProfessora(s.professora_nome) || 'Tia não informada';
    const nascimentoTexto = s.birthDate ? formatarDataBR(s.birthDate) : 'Não informado';
    const linkAtual = this.getParentLinkForStudent(s.id) || {};
    const fotosVisiveis = this.getFotosVisiveisParaResponsavel();
    const tipoAtual = this.activeParentGalleryTab || 'individual';
    const fotosIndividual = fotosVisiveis.filter(f => ['individual', 'aluno'].includes(f.tipo_foto || f.tipo) && String(f.aluno_id) === String(s.id));
    const fotosTurma = fotosVisiveis.filter(f => (f.tipo_foto || f.tipo) === 'turma' && String(f.turma_id || '') === String(s.turma_id || ''));
    const fotosEventos = fotosVisiveis.filter(f => ['evento', 'geral'].includes(f.tipo_foto || f.tipo));
    const fotosAba = tipoAtual === 'turma' ? fotosTurma : tipoAtual === 'eventos' ? fotosEventos : fotosIndividual;
    const totalFotosAluno = fotosIndividual.length + fotosTurma.length + fotosEventos.length;
    const primeiroNomeResponsavel = (responsavel.nome || 'Família').split(' ')[0] || 'Família';
    const primeiroNomeAluno = (s.name || 'Aluno').split(' ')[0] || s.name || 'Aluno';
    const presencaClass = metricas.totalChamadas
      ? (metricas.presencaPct >= 75 ? 'is-good' : 'is-danger')
      : 'is-warn';
    const presencaTexto = metricas.totalChamadas ? `${metricas.presencaPct}%` : 'Sem chamada';
    const profEmail = this.data.professoras.find(p => String(p.id) === String(s.professora_id || ''))?.email || '';

    const childSwitcher = this.data.students.length > 1 ? `
      <div class="parent-v30-child-switcher" aria-label="Trocar filho ativo">
        ${this.data.students.map(child => `
          <button type="button" onclick="window.app.setActiveParentChild('${escapeAttr(child.id)}', 'filho')" class="${String(child.id) === String(s.id) ? 'is-active' : ''}">
            <img src="${escapeAttr(safeUrl(child.photo) || criarAvatarPadrao(child.name))}" alt="${escapeAttr(child.name)}">
            <span>${escapeHTML(child.name.split(' ')[0] || child.name)}</span>
          </button>
        `).join('')}
      </div>
    ` : '';

    const nav = `
      <nav class="parent-v30-nav" aria-label="Navegação do Portal da Família">
        <button type="button" onclick="window.app.setParentPanelTab('inicio')" class="${tabAtual === 'inicio' ? 'is-active' : ''}">
          <i data-lucide="home" class="w-5 h-5"></i><span>Início</span>
        </button>
        <button type="button" onclick="window.app.setParentPanelTab('filho')" class="${tabAtual === 'filho' ? 'is-active' : ''}">
          <i data-lucide="user-round" class="w-5 h-5"></i><span>Filho</span>
        </button>
        <button type="button" onclick="window.app.setParentPanelTab('fotos')" class="${tabAtual === 'fotos' ? 'is-active' : ''}">
          <i data-lucide="images" class="w-5 h-5"></i><span>Fotos</span>
        </button>
        <button type="button" onclick="window.app.setParentPanelTab('colegas')" class="${tabAtual === 'colegas' ? 'is-active' : ''}">
          <i data-lucide="users-round" class="w-5 h-5"></i><span>Colegas</span>
        </button>
        <button type="button" onclick="window.app.setParentPanelTab('filhos')" class="${tabAtual === 'filhos' ? 'is-active' : ''}">
          <i data-lucide="heart-handshake" class="w-5 h-5"></i><span>Filhos</span>
        </button>
        <button type="button" onclick="window.app.setParentPanelTab('conta')" class="${tabAtual === 'conta' ? 'is-active' : ''}">
          <i data-lucide="settings" class="w-5 h-5"></i><span>Perfil</span>
        </button>
      </nav>
    `;

    const homeSection = `
      <section class="parent-v30-page-head">
        <div>
          <p>Hoje no Portal da Família</p>
          <h2>Olá, ${escapeHTML(primeiroNomeResponsavel)} 👋</h2>
          <span>Acompanhe o dia escolar de ${escapeHTML(primeiroNomeAluno)} com dados claros e atualizados.</span>
        </div>
        <button type="button" onclick="window.app.setParentPanelTab('filho')" class="parent-v30-soft-action">
          Ver perfil do filho <i data-lucide="arrow-right" class="w-4 h-4"></i>
        </button>
      </section>

      <section class="parent-v30-smart-grid">
        <article class="parent-v30-stat ${presencaClass}">
          <span><i data-lucide="calendar-check" class="w-5 h-5"></i></span>
          <small>Presença</small>
          <strong>${escapeHTML(presencaTexto)}</strong>
          <em>${metricas.totalChamadas ? `${metricas.presencas} presença(s) · ${metricas.faltas} falta(s)` : 'Aguardando chamada'}</em>
        </article>
        <article class="parent-v30-stat is-award">
          <span><i data-lucide="trophy" class="w-5 h-5"></i></span>
          <small>Conquistas</small>
          <strong>${conquistas.length}</strong>
          <em>${metricas.ocorrencias} ocorrência(s)</em>
        </article>
        <article class="parent-v30-stat is-blue">
          <span><i data-lucide="book-open-check" class="w-5 h-5"></i></span>
          <small>Atividades</small>
          <strong>${atividades.length}</strong>
          <em>${metricas.atividadeNivel}</em>
        </article>
        <article class="parent-v30-stat is-pink">
          <span><i data-lucide="images" class="w-5 h-5"></i></span>
          <small>Fotos</small>
          <strong>${totalFotosAluno}</strong>
          <em>Individual, turma e eventos</em>
        </article>
      </section>

      <section class="parent-v30-feed-grid">
        <article class="parent-v30-card">
          <div class="parent-v30-section-head">
            <span><i data-lucide="sparkles" class="w-5 h-5"></i></span>
            <div>
              <p>Resumo inteligente</p>
              <h3>Destaques recentes</h3>
            </div>
          </div>
          <div class="parent-v30-timeline">
            ${conquistas.slice(0, 2).map(a => {
              const config = getAchievementConfig(a.tipo);
              return `<div><i data-lucide="${config.lucide || 'award'}" class="w-4 h-4"></i><span><strong>${escapeHTML(config.label)}</strong>${escapeHTML(a.descricao || 'Conquista registrada.')}</span></div>`;
            }).join('') || `<div><i data-lucide="star" class="w-4 h-4"></i><span><strong>Sem conquistas recentes</strong>Quando houver novidades, aparecerão aqui.</span></div>`}
            ${atividades.slice(0, 2).map(a => `<div><i data-lucide="book-open-check" class="w-4 h-4"></i><span><strong>${escapeHTML(a.tipo || 'Atividade')}</strong>${escapeHTML(a.description || 'Atividade registrada.')}</span></div>`).join('')}
          </div>
        </article>

        <article class="parent-v30-card parent-v30-mini-gallery">
          <div class="parent-v30-section-head">
            <span><i data-lucide="image" class="w-5 h-5"></i></span>
            <div>
              <p>Fotos recentes</p>
              <h3>Momentos escolares</h3>
            </div>
          </div>
          ${fotosVisiveis.slice(0, 4).length ? `
            <div class="parent-v30-photo-strip">
              ${fotosVisiveis.slice(0, 4).map(f => `<img src="${escapeAttr(f.url)}" alt="${escapeAttr(f.titulo || 'Foto escolar')}">`).join('')}
            </div>
          ` : `<div class="parent-v30-empty-mini">Nenhuma foto publicada ainda.</div>`}
          <button type="button" onclick="window.app.setParentPanelTab('fotos')" class="parent-v30-soft-action is-full">Abrir galeria</button>
        </article>
      </section>
    `;

    const filhoSection = `
      <section class="parent-v31-child-page">
        <article class="parent-v31-child-hero">
          <div class="parent-v31-school-pattern" aria-hidden="true"></div>

          <div class="parent-v31-child-top">
            <div class="parent-v31-child-identity">
              <div class="parent-v31-avatar-wrap">
                <img src="${escapeAttr(safeUrl(s.photo) || criarAvatarPadrao(s.name))}" alt="${escapeAttr(s.name)}">
                <span><i data-lucide="sparkles" class="w-4 h-4"></i></span>
              </div>

              <div class="parent-v31-child-title">
                <small>Perfil escolar do aluno</small>
                <h2>${escapeHTML(s.name)}</h2>
                <p>
                  <span><i data-lucide="cake" class="w-3.5 h-3.5"></i>${escapeHTML(idadeTexto)}</span>
                  <span><i data-lucide="school" class="w-3.5 h-3.5"></i>${escapeHTML(s.turma_nome || 'Turma não informada')}</span>
                  <span><i data-lucide="graduation-cap" class="w-3.5 h-3.5"></i>${escapeHTML(professoraTexto)}</span>
                </p>
              </div>
            </div>

            <div class="parent-v31-child-tools">
              ${this.data.students.length > 1 ? `
                <details class="parent-v31-child-picker">
                  <summary>
                    <i data-lucide="repeat-2" class="w-4 h-4"></i>
                    <span>Trocar perfil</span>
                  </summary>
                  <div>
                    ${this.data.students.map(child => `
                      <button type="button" onclick="window.app.setActiveParentChild('${escapeAttr(child.id)}', 'filho')" class="${String(child.id) === String(s.id) ? 'is-active' : ''}">
                        <img src="${escapeAttr(safeUrl(child.photo) || criarAvatarPadrao(child.name))}" alt="${escapeAttr(child.name)}">
                        <span>
                          <strong>${escapeHTML(child.name)}</strong>
                          <small>${escapeHTML(child.turma_nome || 'Turma não informada')}</small>
                        </span>
                      </button>
                    `).join('')}
                  </div>
                </details>
              ` : ''}

              <button type="button" onclick="window.app.contactTeacherFromParent()" class="parent-v31-icon-action">
                <i data-lucide="message-circle-heart" class="w-4 h-4"></i>
                <span>Professora</span>
              </button>

              <button type="button" onclick="window.app.setParentPanelTab('fotos')" class="parent-v31-icon-action">
                <i data-lucide="images" class="w-4 h-4"></i>
                <span>Fotos</span>
              </button>
            </div>
          </div>

          <div class="parent-v31-child-strip">
            <div class="${presencaClass}">
              <small>Presença</small>
              <strong>${escapeHTML(presencaTexto)}</strong>
              <span>${metricas.totalChamadas ? `${metricas.presencas} presença(s) · ${metricas.faltas} falta(s)` : 'Aguardando chamada'}</span>
            </div>
            <div class="is-blue">
              <small>Atividades</small>
              <strong>${atividades.length}</strong>
              <span>${escapeHTML(metricas.atividadeNivel)}</span>
            </div>
            <div class="is-award">
              <small>Conquistas</small>
              <strong>${conquistas.length}</strong>
              <span>${metricas.ocorrencias ? `${metricas.ocorrencias} ocorrência(s)` : 'Evolução positiva'}</span>
            </div>
            <div class="is-pink">
              <small>Aniversário</small>
              <strong>${aniversarioInfo ? (aniversarioInfo.hoje ? 'Hoje' : `${aniversarioInfo.dias}d`) : '--'}</strong>
              <span>${aniversarioInfo ? (aniversarioInfo.hoje ? 'Parabéns 🎂' : aniversarioInfo.label) : 'Não informado'}</span>
            </div>
          </div>
        </article>

        <section class="parent-v31-reading">
          <div class="parent-v31-section-title">
            <span><i data-lucide="brain" class="w-5 h-5"></i></span>
            <div>
              <small>Leitura rápida</small>
              <h3>Resumo do acompanhamento escolar</h3>
            </div>
          </div>

          <div class="parent-v31-reading-grid">
            <article class="${presencaClass}">
              <div>
                <strong>Presença geral</strong>
                <span>${escapeHTML(metricas.presencaNivel)}</span>
              </div>
              <b>${metricas.presencaPct}%</b>
              <div class="parent-v31-progress"><em style="width:${Math.max(0, Math.min(100, metricas.presencaPct))}%"></em></div>
            </article>

            <article class="${metricas.ocorrencias ? 'is-warn' : 'is-good'}">
              <div>
                <strong>Comportamento</strong>
                <span>${escapeHTML(metricas.comportamentoNivel)}</span>
              </div>
              <b>${metricas.comportamentoPct}%</b>
              <div class="parent-v31-progress"><em style="width:${Math.max(0, Math.min(100, metricas.comportamentoPct))}%"></em></div>
            </article>

            <article class="is-blue">
              <div>
                <strong>Registros pedagógicos</strong>
                <span>${atividades.length} atividade(s) registrada(s)</span>
              </div>
              <b>${conquistas.length + atividades.length}</b>
              <div class="parent-v31-progress"><em style="width:${Math.min(100, (conquistas.length + atividades.length) * 12)}%"></em></div>
            </article>
          </div>
        </section>

        <section class="parent-v31-fluid-grid">
          <article class="parent-v31-panel parent-v31-achievements">
            <div class="parent-v31-section-title">
              <span><i data-lucide="trophy" class="w-5 h-5"></i></span>
              <div>
                <small>Evolução</small>
                <h3>Conquistas e reconhecimentos</h3>
              </div>
            </div>

            <div class="parent-v31-achievement-list">
              ${conquistas.length ? conquistas.slice(0, 6).map(a => {
                const config = getAchievementConfig(a.tipo);
                const tipoKey = normalizarNomeBusca(a.tipo || config.label || 'conquista').replace(/[^a-z0-9]+/g, '-');
                return `
                  <div class="parent-v31-achievement-item is-${escapeAttr(tipoKey)}">
                    <span><i data-lucide="${escapeAttr(config.lucide || 'award')}" class="w-5 h-5"></i></span>
                    <div>
                      <strong>${escapeHTML(config.label || a.tipo || 'Conquista')}</strong>
                      <p>${escapeHTML(a.descricao || 'Reconhecimento registrado pela escola.')}</p>
                      <small>${escapeHTML(formatarDataBR(a.date))}</small>
                    </div>
                  </div>
                `;
              }).join('') : `
                <div class="parent-v31-soft-empty">
                  <i data-lucide="star" class="w-5 h-5"></i>
                  <span>Nenhuma conquista registrada ainda. Quando houver novidade, aparecerá aqui.</span>
                </div>
              `}
            </div>
          </article>

          <article class="parent-v31-panel">
            <div class="parent-v31-section-title">
              <span><i data-lucide="book-open-check" class="w-5 h-5"></i></span>
              <div>
                <small>Aprendizagem</small>
                <h3>Atividades recentes</h3>
              </div>
            </div>

            <div class="parent-v31-activity-list">
              ${atividades.length ? atividades.slice(0, 5).map(a => `
                <div>
                  <span class="${a.feita === false ? 'is-warn' : 'is-good'}">
                    <i data-lucide="${a.feita === false ? 'circle-alert' : 'check-circle-2'}" class="w-4 h-4"></i>
                  </span>
                  <div>
                    <strong>${escapeHTML(a.tipo || 'Atividade')}</strong>
                    <p>${escapeHTML(a.description || 'Atividade registrada pela escola.')}</p>
                    <small>${escapeHTML(formatarDataBR(a.date))} · ${a.feita === false ? 'Não feita' : 'Feita'}</small>
                  </div>
                </div>
              `).join('') : `
                <div class="parent-v31-soft-empty">
                  <i data-lucide="book-open" class="w-5 h-5"></i>
                  <span>Nenhuma atividade registrada ainda.</span>
                </div>
              `}
            </div>
          </article>
        </section>

        <section class="parent-v32-document-hub">
          <div class="parent-v31-section-title">
            <span><i data-lucide="file-text" class="w-5 h-5"></i></span>
            <div>
              <small>Documentos do aluno</small>
              <h3>Abra como uma ficha moderna</h3>
            </div>
          </div>

          <div class="parent-v32-doc-grid">
            <button type="button" onclick="window.app.openParentChildDocument('ficha')" class="parent-v32-doc-card is-main">
              <span><i data-lucide="id-card" class="w-5 h-5"></i></span>
              <strong>Ver ficha completa</strong>
              <small>Dados escolares, responsáveis, contactos, saúde, presença e rotina.</small>
              <em>abrir página</em>
            </button>

            <button type="button" onclick="window.app.openParentChildDocument('responsaveis')" class="parent-v32-doc-card">
              <span><i data-lucide="heart-handshake" class="w-5 h-5"></i></span>
              <strong>Responsáveis</strong>
              <small>Contactos, autorizados, morada e indicações importantes.</small>
              <em>abrir</em>
            </button>

            <button type="button" onclick="window.app.openParentChildDocument('presenca')" class="parent-v32-doc-card">
              <span><i data-lucide="calendar-check" class="w-5 h-5"></i></span>
              <strong>Presença</strong>
              <small>${metricas.presencas} presença(s), ${metricas.faltas} falta(s), ${metricas.presencaPct}% geral.</small>
              <em>abrir</em>
            </button>

            <button type="button" onclick="window.app.openParentChildDocument('rotina')" class="parent-v32-doc-card">
              <span><i data-lucide="calendar-days" class="w-5 h-5"></i></span>
              <strong>Rotina escolar</strong>
              <small>Organização semanal da turma e dados escolares do aluno.</small>
              <em>abrir</em>
            </button>
          </div>
        </section>
      </section>
    `;

    const fotosSection = `
      <section class="parent-v30-page-head">
        <div>
          <p>Galeria escolar</p>
          <h2>Fotos de ${escapeHTML(primeiroNomeAluno)}</h2>
          <span>Individual, turma, eventos e momentos gerais publicados pela escola.</span>
        </div>
      </section>

      <section class="parent-v30-card parent-v30-gallery-card">
        <div class="parent-v30-segmented">
          <button type="button" onclick="window.app.setParentGalleryTab('individual')" class="${tipoAtual === 'individual' ? 'is-active' : ''}">
            <i data-lucide="user-round" class="w-4 h-4"></i><span>Individual</span><strong>${fotosIndividual.length}</strong>
          </button>
          <button type="button" onclick="window.app.setParentGalleryTab('turma')" class="${tipoAtual === 'turma' ? 'is-active' : ''}">
            <i data-lucide="users-round" class="w-4 h-4"></i><span>Turma</span><strong>${fotosTurma.length}</strong>
          </button>
          <button type="button" onclick="window.app.setParentGalleryTab('eventos')" class="${tipoAtual === 'eventos' ? 'is-active' : ''}">
            <i data-lucide="party-popper" class="w-4 h-4"></i><span>Eventos</span><strong>${fotosEventos.length}</strong>
          </button>
        </div>
        ${fotosAba.length ? `<div class="parent-v30-photo-feed">${fotosAba.map(foto => this.renderParentGalleryPhoto(foto)).join('')}</div>` : `<div class="parent-v30-empty-state"><i data-lucide="image-plus" class="w-5 h-5"></i>Nenhuma foto nesta galeria ainda. Quando a professora publicar, aparecerá aqui automaticamente.</div>`}
      </section>
    `;

    const filhosSection = `
      <section class="parent-v30-page-head">
        <div>
          <p>Família vinculada</p>
          <h2>Meus filhos no portal</h2>
          <span>O primeiro filho fica bloqueado após confirmação. Para adicionar outros, use o código enviado pela escola.</span>
        </div>
      </section>

      <section class="parent-v30-card">
        <div class="parent-v30-children-grid">
          ${this.data.students.map(child => {
            const childLink = this.getParentLinkForStudent(child.id);
            return `
              <article class="parent-v30-child-tile ${String(child.id) === String(s.id) ? 'is-current' : ''}">
                <img src="${escapeAttr(safeUrl(child.photo) || criarAvatarPadrao(child.name))}" alt="${escapeAttr(child.name)}">
                <div>
                  <strong>${escapeHTML(child.name)}</strong>
                  <small>${escapeHTML(child.turma_nome || 'Turma não informada')}</small>
                  <em>${childLink?.ficha_revisada ? 'Ficha revisada' : 'Ficha pendente'}</em>
                </div>
                <button type="button" onclick="window.app.setActiveParentChild('${escapeAttr(child.id)}', 'filho')">Abrir</button>
              </article>
            `;
          }).join('')}
        </div>

        <div class="parent-v30-add-child">
          <div>
            <strong>Adicionar outro filho</strong>
            <p>Peça à professora o código de vínculo e cole abaixo. Assim evitamos qualquer vínculo errado.</p>
          </div>
          <div>
            <input id="parent-add-child-code" class="app-input text-center uppercase tracking-[0.25em] font-black" placeholder="ABCD-1234">
            <button type="button" onclick="window.app.linkAdditionalChildByInviteCode()" class="parent-v30-primary">
              <i data-lucide="plus-circle" class="w-4 h-4"></i> Vincular filho
            </button>
          </div>
        </div>
      </section>
    `;

    const contaSection = `
      <section class="parent-v30-page-head">
        <div>
          <p>Perfil do usuário</p>
          <h2>Minha conta</h2>
          <span>Dados básicos, segurança e canais de apoio do Portal da Família.</span>
        </div>
      </section>

      <section class="parent-v30-account-grid">
        <article class="parent-v30-card parent-v30-account-card">
          <div class="parent-v30-account-avatar">
            ${responsavel.avatar_url ? `<img src="${escapeAttr(responsavel.avatar_url)}" alt="${escapeAttr(responsavel.nome || 'Responsável')}">` : `<span>${escapeHTML((responsavel.nome || 'F').trim().charAt(0).toUpperCase() || 'F')}</span>`}
          </div>
          <h3>${escapeHTML(responsavel.nome || 'Responsável')}</h3>
          <p>${escapeHTML(responsavel.email || 'Email não informado')}</p>
          <div class="parent-v30-account-badges">
            <span>${escapeHTML(responsavel.parentesco_padrao || linkAtual.parentesco || 'Responsável')}</span>
            <span>${this.data.students.length} filho(s)</span>
          </div>
        </article>

        <article class="parent-v30-card">
          <div class="parent-v30-section-head">
            <span><i data-lucide="settings" class="w-5 h-5"></i></span>
            <div><p>Configurações</p><h3>Ações da conta</h3></div>
          </div>
          <div class="parent-v30-settings-list">
            <button type="button" onclick="window.app.requestParentPasswordReset()"><i data-lucide="key-round" class="w-5 h-5"></i><span><strong>Trocar senha</strong><small>Receba um link seguro no email</small></span></button>
            <button type="button" onclick="window.app.contactTeacherFromParent()"><i data-lucide="message-circle" class="w-5 h-5"></i><span><strong>Falar com professora</strong><small>${escapeHTML(profEmail || 'Canal da escola')}</small></span></button>
            <button type="button" onclick="window.app.openParentSupport()"><i data-lucide="life-buoy" class="w-5 h-5"></i><span><strong>Suporte</strong><small>Ajuda para usar o portal</small></span></button>
            <button type="button" onclick="window.app.logout()" class="is-danger"><i data-lucide="log-out" class="w-5 h-5"></i><span><strong>Sair da conta</strong><small>Encerrar sessão neste dispositivo</small></span></button>
          </div>
        </article>
      </section>
    `;

    const sectionByTab =
      tabAtual === 'filho' ? filhoSection :
      tabAtual === 'fotos' ? fotosSection :
      tabAtual === 'colegas' ? this.renderParentClassmates(s) :
      tabAtual === 'filhos' ? filhosSection :
      tabAtual === 'conta' ? contaSection :
      homeSection;

    container.innerHTML = `
      <div class="parent-v30 parent-v30-app">
        ${nav}

        <main class="parent-v30-main">
          ${sectionByTab}
        </main>
      </div>
    `;

    refreshIcons();
  }


};

window.app = app;

document.addEventListener('DOMContentLoaded', () => {
  window.app = app;
  app.init();
});

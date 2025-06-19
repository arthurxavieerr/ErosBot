const oldWrite = process.stdout.write;
const unwantedLogPatterns = [
  // Logs de conexão/autenticação
  /\[INFO\] - \[Running gramJS version/,
  /\[Connecting to \d+\.\d+\.\d+\.\d+:\d+\/TCPFull\.\.\.\]/,
  /\[Connection to \d+\.\d+\.\d+\.\d+:\d+\/TCPFull complete!\]/,
  /\[Using LAYER \d+ for initial connect\]/,
  /\[Connected to /,
  /\[WARN\] - \[Connection closed while receiving data\]/,
  /\[WARN\] - \[Disconnecting\.\.\.\]/,
  /\[INFO\] - \[Disconnecting from \d+\.\d+\.\d+\.\d+:\d+\/TCPFull\.\.\.\]/,
  /\[INFO\] - \[connection closed\]/,
  /\[INFO\] - \[Connecting to /,
  /\[INFO\] - \[Connected! Reading responses/,
  /\[INFO\] - \[Received response of type /,
  /\[INFO\] - \[Sequential: false/,
  /\[INFO\] - \[First message ID: /,
  /\[INFO\] - \[Last message ID: /,
  /\[INFO\] - \[Messages: \d+\]/,
  /\[INFO\] - \[Contains MORE: /,
  /Error: Not connected/,
  /\[INFO\] - \[Got response! /,
  /\[INFO\] - \[Starting auth import/,
  /\[INFO\] - \[Auth key already exists/,
  /\[INFO\] - \[Connection inited!/,
  /\[INFO\] - \[Starting session import/,
  /\[INFO\] - \[Session imported!/,
  /\[INFO\] - \[Updating session/,
  /\[INFO\] - \[Session has been updated/,
  /\[INFO\] - \[Starting initial connection/,
  /\[INFO\] - \[Initial connection complete!/,
  
  // Adicione mais padrões aqui se ainda aparecerem logs indesejados
];

let disconnectLogged = false;

process.stdout.write = function (chunk, encoding, callback) {
  const str = chunk.toString();
  if (unwantedLogPatterns.some(rgx => rgx.test(str))) {
    if (!disconnectLogged &&
      (/\[Disconnecting/.test(str) || /\[connection closed\]/.test(str) || /Not connected/.test(str))
    ) {
      logWithTime('🔴 O bot perdeu a conexão com o Telegram! Tentando reconectar...', chalk.red);
      disconnectLogged = true;
    }
    return true; // Suprime o log original
  }
  // Se conectar novamente, reseta o flag
  if (/\[Connected to /.test(str)) {
    if (disconnectLogged) logWithTime('🟢 Reconectado ao Telegram!', chalk.green);
    disconnectLogged = false;
  }
  return oldWrite.apply(process.stdout, arguments);
};

process.stdout.write = function (chunk, encoding, callback) {
  const str = chunk.toString();
  if (unwantedLogPatterns.some(rgx => rgx.test(str))) {
    return true; // Silencia o log
  }
  return oldWrite.apply(process.stdout, arguments);
};
import './bootstrap-log.js';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/NewMessage.js';
import TelegramBot from 'node-telegram-bot-api';
import chalk from 'chalk';
import mime from 'mime-types';
import { randomUUID } from 'crypto';


// === CONFIGURAÇÕES ===
const API_ID = 20372456;
const API_HASH = '4bf8017e548b790415a11cc8ed1b9804';
const STRING_SESSION = '1AQAOMTQ5LjE1NC4xNzUuNTkBu6X29O7axAtLUi2GfzVFbqqdwQuQjZWF72nni1QdTA3nSYJl1kiCTNmM1s0SprwxN9kkTc2In9TViYeLsHtPgYpBDF+unJUjedI9ztx74qmJVYoUCYayXcff86/iWTKh5bfZM8GNKpgpxrSDh7dOD4o1FB6yIBRJHDqeOBPf8gP/EaLgJTVq87/hZBK+8KKhM29RJLeXZLXesUYWte42w2tmKY2KpvM8xzKcI1gYGmEYu+BhlBvwvh4mK8WVECV1mB/vHzlaa0RE8bd1jugVY3VJD/R9u5R0ygXROfg3N3bDvVTsmpqIpnsGu1o4kmKyZT3OoHAYy/WyOiRMwe2Udak=';

// Token do bot para edição (substitua pelo seu token real)
const BOT_TOKEN = '8105675502:AAEqXzSq_KaeNufwPL2TliJoMl2xiMUPRi8';

// Caminhos dos arquivos de configuração
const transformations = new Map();
const FILE_PATH = 'fixed_message.txt';
const DEFAULT_MESSAGE = 'Esta é a mensagem fixa que substituirá qualquer mensagem enviada.';
const TRANSFORM_PATH = 'transformacoes.json';
const BLACKLIST_PATH = 'blacklist.json';
const DOWNLOADS_PATH = './downloads';

// === CONFIGURAÇÕES DO BOT DE REPASSE ===
const PARES_REPASSE = {
  '-1001234567890': '-1009876543210',
  '-1001161980965': '-1002519203567',
  '-1001556868697': '-1002655206464',
  '-1002655206464': '-1002519203567',
};

// Timeouts para buffers
const ALBUM_TIMEOUT = 120000;
const BUFFER_SEM_GROUP_TIMEOUT = 120000;
const EDIT_TIMEOUT = 3000; // 15 segundos para edição

// === INICIALIZAÇÃO ===
const client = new TelegramClient(new StringSession(STRING_SESSION), API_ID, API_HASH, {
  connectionRetries: 5,
  retryDelay: 1000,
  timeout: 10,
  autoReconnect: true,
  maxConcurrentDownloads: 1,
  useWSS: true,
  logger: { // Adicione esta configuração
    log: () => {}, // Função vazia para logs normais
    warn: () => {}, // Função vazia para avisos
    error: (e) => logWithTime(`❌ Erro crítico: ${e}`, chalk.red), // Mantém apenas erros críticos
    info: () => {}, // Função vazia para informações
    debug: () => {} // Função vazia para debug
  }
});

let isEditActive = true; // Ativado por padrão
let fixedMessage = loadFixedMessage();
let transformacoes = loadJSON(TRANSFORM_PATH, {});
let blacklist = loadJSON(BLACKLIST_PATH, []);
if (!Array.isArray(blacklist)) blacklist = [];

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Buffers e controle
const album_cache = new Map();
const album_metadata = new Map(); // Novo map para metadados do álbum
const timeout_tasks = new Map();
const buffer_sem_group = new Map();
const buffer_sem_group_tasks = new Map();
const mensagens_processadas = new Set();
const messageEditBuffer = new Map();
const albuns_bloqueados = new Set();
const validTokens = new Set();

// === CRIAR PASTA DE DOWNLOADS ===
if (!fsSync.existsSync(DOWNLOADS_PATH)) {
  fsSync.mkdirSync(DOWNLOADS_PATH, { recursive: true });
}

// === UTILITÁRIOS ===
function gerarToken() {
  return randomUUID();
}
function getFileOptions(filePath) {
  return {
    filename: path.basename(filePath),
    contentType: mime.lookup(filePath) || 'application/octet-stream'
  };
}
function logWithTime(message, color = chalk.white) {
  const now = new Date();
  const timestamp = now.toLocaleString('pt-BR');
  console.log(color(`[${timestamp}] ${message}`));
}
function initializeAlbumMetadata(albumKey, groupId) {
  album_metadata.set(albumKey, {
    groupId: groupId,
    totalExpected: null,
    mediaTypes: new Set(),
    lastUpdateTime: Date.now(),
    isComplete: false,
    processingStarted: false,
    isProcessing: false,      // Nova flag para controle de processamento
    attemptCount: 0,          // Contador de tentativas
    startTime: new Date().toISOString(), // Data/hora de início
    createdBy: 'arthurxavieerr' // Usuário que criou
  });

  logWithTime(`🆕 Novo álbum inicializado:
    • Key: ${albumKey}
    • Group: ${groupId}
    • Time: ${new Date().toISOString()}
    • User: arthurxavieerr`, chalk.cyan);
}

function monitorActiveAlbums() {
  setInterval(() => {
    const activeAlbums = Array.from(album_metadata.entries());
    if (activeAlbums.length === 0) return;
    
    for (const [albumKey, metadata] of activeAlbums) {
      if (albuns_bloqueados.has(albumKey)) continue;
      const messages = album_cache.get(albumKey) || [];
      const timeElapsed = Date.now() - metadata.lastUpdateTime;
      
      logWithTime(`📊 Álbum ${albumKey}:
        • Mensagens: ${messages.length}
        • Tempo desde última atualização: ${timeElapsed/1000}s
        • Status: ${metadata.isProcessing ? '🔄 Processando' : '⏳ Aguardando'}
        • Tentativas: ${metadata.attemptCount}`, chalk.blue);
    }
  }, 30000); // A cada 30 segundos
}


function checkAlbumProcessingStatus(albumKey) {
  const metadata = album_metadata.get(albumKey);
  if (!metadata) return false;

  const status = {
    isProcessing: metadata.isProcessing,
    attempts: metadata.attemptCount,
    elapsed: Date.now() - new Date(metadata.startTime).getTime(),
    canProcess: !metadata.isProcessing && metadata.attemptCount < 3
  };

function setupAlbumTimeout(albumKey) {
  const MAXIMUM_ALBUM_LIFETIME = 300000; // 5 minutos
  
  setTimeout(() => {
    const metadata = album_metadata.get(albumKey);
    if (metadata && !metadata.isProcessing) {
      logWithTime(`⏰ Timeout forçado para álbum ${albumKey}`, chalk.yellow);
      cleanupAlbumResources(albumKey);
    }
  }, MAXIMUM_ALBUM_LIFETIME);
}

  logWithTime(`🔍 Status do álbum ${albumKey}:
    • Processando: ${status.isProcessing ? 'Sim' : 'Não'}
    • Tentativas: ${status.attempts}/3
    • Tempo decorrido: ${Math.floor(status.elapsed/1000)}s
    • Pode processar: ${status.canProcess ? 'Sim' : 'Não'}`, chalk.blue);

  return status.canProcess;
}


function updateAlbumMetadata(albumKey, message) {
  const metadata = album_metadata.get(albumKey);
  if (!metadata) return;

  // Atualizar tipos de mídia
  if (message.media?.photo) metadata.mediaTypes.add('photo');
  if (message.media?.document) {
    const mimeType = message.media.document.mimeType || '';
    if (mimeType.startsWith('video/')) metadata.mediaTypes.add('video');
    else if (mimeType.startsWith('image/')) metadata.mediaTypes.add('photo');
  }

  metadata.lastUpdateTime = Date.now();

  // Se for possível, defina o total esperado
  if (metadata.totalExpected === null && message.groupedId) {
    // Caso algum dia consiga extrair o tamanho do grupo
    metadata.totalExpected = message.media?.group_size || null;
  }
}

function isAlbumComplete(albumKey) {
  const metadata = album_metadata.get(albumKey);
  if (!metadata) return false;

  const messages = album_cache.get(albumKey) || [];
  const timeElapsed = Date.now() - metadata.lastUpdateTime;
  
  // Aumentar o tempo mínimo de espera para garantir que todas as mensagens cheguem
  const MIN_WAIT_TIME = 5000; // 5 segundos mínimo de espera
  
  // NOVA VERIFICAÇÃO: Garantir que temos todas as mídias do mesmo tipo juntas
  const mediaTypes = new Set(messages.map(msg => {
    if (msg.media?.photo) return 'photo';
    if (msg.media?.document) {
      const mimeType = msg.media.document.mimeType || '';
      if (mimeType.startsWith('video/')) return 'video';
      if (mimeType.startsWith('image/')) return 'photo';
    }
    return 'unknown';
  }));

  // Se tivermos fotos e vídeos misturados, aguardar mais tempo
  const hasMixedTypes = mediaTypes.size > 1;
  const MIXED_TYPES_WAIT = hasMixedTypes ? 10000 : MIN_WAIT_TIME; // 10 segundos para tipos mistos
  
  // Verificar se as mensagens estão em sequência
  const messageIds = messages.map(m => m.id).sort((a, b) => a - b);
  const isSequential = messageIds.every((id, index) => {
    if (index === 0) return true;
    return (id - messageIds[index - 1]) === 1;
  });

  // Condições para considerar o álbum completo
  const hasEnoughWaitTime = timeElapsed >= MIXED_TYPES_WAIT;
  const hasMinimumMessages = messages.length >= 2;
  const isStable = timeElapsed >= (messages.length * 1000); // 1 segundo por mensagem

  // Log detalhado do status
  logWithTime(`🔍 Verificando completude do álbum ${albumKey}:
    • Mensagens: ${messages.length}
    • Tipos de mídia: ${Array.from(mediaTypes).join(', ')}
    • Tempo decorrido: ${timeElapsed}ms
    • Sequencial: ${isSequential}
    • Tempo mínimo: ${hasEnoughWaitTime}
    • Estável: ${isStable}`, chalk.blue);

  return hasEnoughWaitTime && hasMinimumMessages && isSequential && isStable;
}

async function downloadMediaWithRetry(message, filename, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const filePath = await downloadMedia(message, filename);
    if (filePath) return filePath;
    logWithTime(`⚠️ Download falhou, tentativa ${i + 1} de ${retries}`, chalk.yellow);
    await new Promise(res => setTimeout(res, 2000));
  }
  return null;
}


function loadFixedMessage() {
  try {
    if (fsSync.existsSync(FILE_PATH)) {
      const msg = fsSync.readFileSync(FILE_PATH, 'utf-8').trim();
      //logWithTime('📌 Mensagem fixa carregada do arquivo.', chalk.blue);       ///////////////////LOG DE MENSAGEM FIXA CARREGADA
      return msg;
    }
  } catch (err) {
    logWithTime(`❌ Erro ao carregar mensagem fixa: ${err.message}`, chalk.red);
  }
  logWithTime('⚠️ Nenhum arquivo encontrado. Usando mensagem padrão.', chalk.yellow);
  return DEFAULT_MESSAGE;
}

function saveFixedMessage(text) {
  try {
    fsSync.writeFileSync(FILE_PATH, text, 'utf-8');
    logWithTime('💾 Mensagem fixa salva com sucesso!', chalk.green);
  } catch (err) {
    logWithTime(`❌ Erro ao salvar mensagem fixa: ${err.message}`, chalk.red);
  }
}
async function cleanOldDownloads(dir, maxAgeMinutes = 60) {
  const files = await fs.readdir(dir);
  const now = Date.now();
  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const stats = await fs.stat(filePath);
      if (now - stats.mtimeMs > maxAgeMinutes * 60 * 1000) {
        await fs.unlink(filePath);
        logWithTime(`🧹 Arquivo antigo removido: ${filePath}`);
      }
    } catch (e) {/* ignorar erros */}
  }
}
function loadJSON(path, fallback) {
  try {
    if (fsSync.existsSync(path)) {
      return JSON.parse(fsSync.readFileSync(path, 'utf-8'));
    }
  } catch (e) {
    logWithTime(`❌ Erro ao carregar ${path}`, chalk.red);
  }
  return fallback;
}

function saveJSON(path, data) {
  try {
    fsSync.writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
    logWithTime(`💾 Dados salvos em ${path}`, chalk.green);
  } catch (e) {
    logWithTime(`❌ Erro ao salvar ${path}`, chalk.red);
  }
}

// === FUNÇÕES DE EXTRAÇÃO DE CHAT ID ===
function extractChatId(message) {
  try {
    if (message.peerId && message.peerId.channelId) {
      return `-100${message.peerId.channelId}`;
    }
    
    if (message.peerId && message.peerId.chatId) {
      return `-${message.peerId.chatId}`;
    }
    
    if (message.peerId && message.peerId.userId) {
      return message.peerId.userId.toString();
    }
    
    if (message.chatId) {
      return message.chatId.toString();
    }
    
    if (message.toId) {
      if (message.toId.channelId) {
        return `-100${message.toId.channelId}`;
      }
      if (message.toId.chatId) {
        return `-${message.toId.chatId}`;
      }
      if (message.toId.userId) {
        return message.toId.userId.toString();
      }
    }
    
    return null;
  } catch (error) {
    logWithTime(`❌ Erro ao extrair chat ID: ${error.message}`, chalk.red);
    return null;
  }
}

// === VERIFICAÇÃO DE FRASES PROIBIDAS ===
function containsForbiddenPhrase(text) {
  if (!text) return false;
  text = text.toLowerCase();
  if (!Array.isArray(blacklist)) return false; // segurança extra
  return blacklist.some(palavra => text.includes(palavra.toLowerCase()));
}


function albumContainsForbiddenPhrase(mensagens) {
  for (const msg of mensagens) {
    const txt = (msg.caption ?? msg.message ?? '').toLowerCase();
    if (containsForbiddenPhrase(txt)) {
      logWithTime(`❌ Álbum contém frase proibida na mensagem ${msg.id}: "${txt.substring(0, 50)}..."`, chalk.red);
      return true;
    }
  }
  return false;
}

function aplicarTransformacoes(texto) {
  if (!texto) return '';
  for (const [chave, valor] of Object.entries(transformacoes)) {
    texto = texto.replace(new RegExp(chave, 'gi'), valor);
  }
  return texto;
}

// === FUNÇÃO CORRIGIDA PARA COMBINAR DUAS PRIMEIRAS LINHAS + MENSAGEM FIXA ===
function createEditedCaption(originalCaption, fixedMessage) {
  logWithTime(`🪄 Criando legenda editada - Original: "${originalCaption ? originalCaption.substring(0, 100) : 'VAZIO'}..."`, chalk.blue);
  
  if (!originalCaption || originalCaption.trim() === '') {
    const resultado = aplicarTransformacoes(fixedMessage);
    logWithTime(`🫙 Legenda vazia, usando apenas mensagem fixa: "${resultado.substring(0, 50)}..."`, chalk.cyan);
    return resultado;
  }

  // Dividir por linhas e filtrar linhas não vazias
  const lines = originalCaption.split('\n');
  const nonEmptyLines = lines.filter(line => line.trim() !== '');
  
  logWithTime(`🔍 Análise da legenda original: ${lines.length} linhas totais, ${nonEmptyLines.length} não vazias`, chalk.blue);
  
  let preservedText = '';
  
  // Preservar as duas primeiras linhas com conteúdo
  if (nonEmptyLines.length >= 2) {
    preservedText = nonEmptyLines[0] + '\n' + nonEmptyLines[1];
    logWithTime(`✅ Preservando 2 primeiras linhas: "${preservedText.substring(0, 50)}..."`, chalk.green);
  } else if (nonEmptyLines.length === 1) {
    preservedText = nonEmptyLines[0];
    logWithTime(`✅ Preservando 1 linha: "${preservedText.substring(0, 50)}..."`, chalk.green);
  } else {
    const resultado = aplicarTransformacoes(fixedMessage);
    logWithTime(`⚠️ Nenhuma linha com conteúdo, usando apenas mensagem fixa`, chalk.yellow);
    return resultado;
  }

  // Combinar as linhas preservadas + quebra dupla + mensagem fixa
  const resultado = preservedText + '\n\n' + fixedMessage;
  const resultadoFinal = aplicarTransformacoes(resultado);
  
  logWithTime(`✅ Legenda editada criada: "${resultadoFinal.substring(0, 100)}..."`, chalk.green);
  return resultadoFinal;
}

// === DOWNLOAD DE MÍDIA ===
async function downloadMedia(message, filename) {
  try {
    logWithTime(`⬇📥  Baixando mídia: ${filename}`, chalk.yellow);
    
    const filePath = path.join(DOWNLOADS_PATH, filename);
    const buffer = await client.downloadMedia(message, { outputFile: filePath });
    
    if (buffer) {
      logWithTime(`✅ Mídia baixada: ${filename}`, chalk.green);
      return filePath;
    }
    
    return null;
  } catch (error) {
    logWithTime(`❌ Erro ao baixar mídia: ${error.message}`, chalk.red);
    return null;
  }
}

// === DETECTAR TIPO DE MÍDIA ===
function detectMediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
    return 'photo';
  } else if (['.mp4', '.avi', '.mov', '.mkv', '.webm'].includes(ext)) {
    return 'video';
  } else if (['.mp3', '.wav', '.ogg', '.m4a', '.flac'].includes(ext)) {
    return 'audio';
  } else {
    return 'document';
  }
}

// === ENVIO DE MÍDIA COM LEGENDA ORIGINAL (CORRIGIDA) ===
async function enviarMidiaComLegendaOriginal(filePath, originalCaption, destino, mediaType = null) {
  try {
    const tipo = mediaType || detectMediaType(filePath);
    
    // CRÍTICO: Armazenar a legenda original ANTES de aplicar transformações
    const legendaOriginalPura = originalCaption ?? '';
    logWithTime(`📤 Enviando mídia com legenda original: "${legendaOriginalPura.substring(0, 50)}..."`, chalk.blue);
    
    // Aplicar apenas transformações na legenda original (NÃO adicionar mensagem fixa ainda)
    const legendaComTransformacoes = aplicarTransformacoes(legendaOriginalPura);
    
    const options = {
      chat_id: destino,
      caption: legendaComTransformacoes,
      parse_mode: 'HTML'
    };

      let result;
      const fileOptions = getFileOptions(filePath);

      switch (tipo) {
        case 'photo':
          result = await bot.sendPhoto(destino, { source: filePath, ...fileOptions }, options);
          break;
        case 'video':
          result = await bot.sendVideo(destino, { source: filePath, ...fileOptions }, options);
          break;
        case 'audio':
          result = await bot.sendAudio(destino, { source: filePath, ...fileOptions }, options);
          break;
        default:
          result = await bot.sendDocument(destino, { source: filePath, ...fileOptions }, options);
      }

    try {
      await fs.unlink(filePath);
    } catch (e) {
      logWithTime(`⚠️ Erro ao deletar arquivo temporário: ${e.message}`, chalk.yellow);
    }

    logWithTime(`✅ Mídia enviada com legenda original preservada`, chalk.green);
    return result;
  } catch (error) {
    logWithTime(`❌ Erro ao enviar mídia: ${error.message}`, chalk.red);
    try {
      await fs.unlink(filePath);
    } catch (e) {}
    return null;
  }
}

// === FUNÇÃO PARA AGENDAR EDIÇÃO ===
function scheduleMessageEditing(chatId, sentMessages, originalCaptions) {
  logWithTime(`DEBUG: Entrei em scheduleMessageEditing!`, chalk.red);
  if (!isEditActive) {
    logWithTime(`⚠️ Edição desativada - não agendando edição`, chalk.yellow);
    return;
  }
  
  const editKey = `${chatId}_${Date.now()}`;
  
  const editData = {
    chatId: chatId,
    sentMessages: sentMessages,
    originalCaptions: originalCaptions,
    timestamp: Date.now()
  };
  
  messageEditBuffer.set(editKey, editData);
  
  logWithTime(`📅 Edição agendada para ${sentMessages.length} mensagens em ${EDIT_TIMEOUT/1000} segundos`, chalk.blue);
  logWithTime(`🧺 Legendas originais armazenadas: ${originalCaptions.map(cap => `"${(cap || 'VAZIO').substring(0, 30)}..."`).join(', ')}`, chalk.cyan);
  
  // Agendar edição
  setTimeout(() => {
    processMessageEditing(editKey);
  }, EDIT_TIMEOUT);
}

// === FUNÇÃO PARA PROCESSAR EDIÇÃO (CORRIGIDA) ===
async function processMessageEditing(editKey) {
  const editData = messageEditBuffer.get(editKey);
  if (!editData) {
    logWithTime(`⚠️ Dados de edição não encontrados para chave: ${editKey}`, chalk.yellow);
    return;
  }
  
  messageEditBuffer.delete(editKey);
  
  const { chatId, sentMessages, originalCaptions } = editData;
  
  logWithTime(`🔄 Iniciando processo de edição para ${sentMessages.length} mensagens`, chalk.cyan);
  
  try {
    // Para álbuns, editar apenas a primeira mensagem
    const firstMessage = sentMessages[0];
    const messageId = firstMessage.message?.message_id || firstMessage.message_id;
    
    if (!messageId) {
      logWithTime(`⚠️ ID da primeira mensagem não encontrado`, chalk.yellow);
      return;
    }
    
    // CRÍTICO: Pegar a legenda original da primeira mensagem
    const legendaParaUsar = originalCaptions.find(
      caption => caption && caption.trim() !== "" && caption.trim().toUpperCase() !== "VAZIO..."
    ) || '';
    logWithTime(`🔍 Legenda original da primeira mensagem: "${legendaParaUsar.substring(0, 100)}..."`, chalk.blue);

    // Criar a legenda editada usando a função corrigida
    const editedCaption = createEditedCaption(legendaParaUsar, fixedMessage);
    if (editedCaption.trim() !== '') {
      try {
        await bot.editMessageCaption(editedCaption, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML'
        });
        logWithTime(`✅ Legenda editada para mensagem ${messageId}`, chalk.green);
        logWithTime(`📝 Nova legenda: "${editedCaption.substring(0, 100)}..."`, chalk.cyan);
        
        if (sentMessages.length > 1) {
          logWithTime(`ℹ️ Álbum com ${sentMessages.length} mensagens - apenas a primeira foi editada`, chalk.blue);
        }
        
      } catch (editError) {
        logWithTime(`❌ Erro ao editar legenda da mensagem ${messageId}: ${editError.message}`, chalk.red);
      }
    } else {
      logWithTime(`⚠️ Legenda editada vazia - não editando`, chalk.yellow);
    }
    
  } catch (error) {
    logWithTime(`❌ Erro durante processo de edição: ${error.message}`, chalk.red);
  }
}

// === ENVIO DE MÍDIA INDIVIDUAL (CORRIGIDA) ===
async function enviarMidiaIndividual(mensagem, destino_id) {
  if (mensagens_processadas.has(mensagem.id)) return;
  
  const txt = (mensagem.caption ?? mensagem.message ?? '').toLowerCase();
  if (containsForbiddenPhrase(txt)) {
    logWithTime(`❌ Mensagem ${mensagem.id} contém frase proibida, ignorando...`, chalk.red);
    mensagens_processadas.add(mensagem.id);
    return;
  }

  if (!mensagem.media && mensagem.message) {
    try {
      // CRÍTICO: Para mensagens de texto, armazenar o texto original
      const textoOriginal = mensagem.message;
      const textoComTransformacoes = aplicarTransformacoes(textoOriginal);
      
      logWithTime(`💬 Enviando texto original: "${textoOriginal.substring(0, 50)}..."`, chalk.blue);
      
      const result = await bot.sendMessage(destino_id, textoComTransformacoes);
      mensagens_processadas.add(mensagem.id);
      
      if (isEditActive && result) {
        logWithTime(`📝 Agendando edição para mensagem de texto`, chalk.blue);
        // Passar o texto ORIGINAL para edição
        scheduleMessageEditing(destino_id, [{ message: result }], [textoOriginal]);
      }
      
      logWithTime(`✅ Mensagem de texto enviada`, chalk.green);
    } catch (error) {
      logWithTime(`❌ Erro ao enviar mensagem de texto: ${error.message}`, chalk.red);
    }
    return;
  }

  if (!mensagem.media) {
    logWithTime(`⚠️ Mensagem ${mensagem.id} sem mídia e sem texto, ignorando...`, chalk.yellow);
    mensagens_processadas.add(mensagem.id);
    return;
  }

  const filename = `temp_${mensagem.id}_${Date.now()}.${getFileExtension(mensagem)}`;
  const filePath = await downloadMedia(mensagem, filename);
  
  if (filePath) {
    // CRÍTICO: Armazenar a legenda original SEM modificações
    const originalCaption = mensagem.caption || '';
    logWithTime(`📤 Enviando mídia individual com legenda original: "${originalCaption.substring(0, 50)}..."`, chalk.blue);
    
    // Enviar com legenda ORIGINAL (com transformações)
    const result = await enviarMidiaComLegendaOriginal(filePath, originalCaption, destino_id);
    
    if (result && isEditActive) {
      logWithTime(`📝 Agendando edição para mídia individual`, chalk.blue);
      // Passar a legenda ORIGINAL para edição
      scheduleMessageEditing(destino_id, [{ message: result }], [originalCaption]);
    }
    
    mensagens_processadas.add(mensagem.id);
    logWithTime(`✅ Mídia individual enviada`, chalk.green);
  } else {
    logWithTime(`❌ Falha ao baixar mídia da mensagem ${mensagem.id}`, chalk.red);
  }
}

// === FUNÇÃO AUXILIAR: OBTER EXTENSÃO DO ARQUIVO ===
function getFileExtension(message) {
  if (!message.media) return 'bin';
  
  try {
    if (message.media.photo) return 'jpg';
    if (message.media.document) {
      const fileName = message.media.document.attributes?.find(attr => attr.fileName)?.fileName;
      if (fileName) {
        const ext = path.extname(fileName);
        return ext ? ext.slice(1) : 'bin';
      }
      
      const mimeType = message.media.document.mimeType;
      if (mimeType) {
        if (mimeType.includes('video')) return 'mp4';
        if (mimeType.includes('audio')) return 'mp3';
        if (mimeType.includes('image')) return 'jpg';
      }
    }
  } catch (e) {
    logWithTime(`⚠️ Erro ao detectar extensão: ${e.message}`, chalk.yellow);
  }
  
  return 'bin';
}


async function buffer_sem_group_timeout_handler(chatId) {
  const msgs = buffer_sem_group.get(chatId) || [];
  buffer_sem_group.delete(chatId);
  buffer_sem_group_tasks.delete(chatId);

  if (msgs.length === 0) return;

  logWithTime(`☁️ Processando buffer sem grupo com ${msgs.length} mensagens (chatId: ${chatId})`, chalk.blue);

  for (const msg of msgs) {
    const destino = PARES_REPASSE[chatId];
    if (destino) {
      try {
        await enviarMidiaIndividual(msg, destino);
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        logWithTime(`❌ Erro ao processar mensagem individual: ${error.message}`, chalk.red);
      }
    }
  }
}

// === CORREÇÃO PRINCIPAL: FUNÇÃO PARA MANTER DUAS PRIMEIRAS LINHAS + MENSAGEM FIXA ===
function createEditedCaptionFixed(originalCaption, fixedMessage) {
  logWithTime(`🪄 Criando legenda editada`, chalk.yellow);
  logWithTime(`📝 Original: "${originalCaption ? originalCaption.substring(0, 100) : 'VAZIO'}..."`, chalk.cyan);
  logWithTime(`📝 Mensagem fixa: "${fixedMessage.substring(0, 50)}..."`, chalk.cyan);
  
  if (!originalCaption || originalCaption.trim() === '') {
    const resultado = aplicarTransformacoes(fixedMessage);
    logWithTime(`🫙 Legenda vazia, usando apenas mensagem fixa`, chalk.yellow);
    return resultado;
  }

  // Dividir por quebras de linha, mantendo linhas vazias para preservar formatação
  const lines = originalCaption.split('\n');
  
  // Encontrar o índice da primeira linha que contém "⚡️Onlyfans"
  const keyword = "⚡️Onlyfans";
  const idx = lines.findIndex(line => line.includes(keyword));

  let preservedLines = [];
  if (idx !== -1) {
    // Preserva todas as linhas ANTES da linha do keyword
    preservedLines = lines.slice(0, idx);
    logWithTime(`✅ Preservando linhas até "${keyword}" (não incluso).`, chalk.green);
  } else {
    // Se não encontrar, preserve só a primeira linha (ou ajuste como preferir)
    preservedLines = [lines[0]];
    logWithTime(`⚠️ Palavra-chave não encontrada, preservando apenas a primeira linha.`, chalk.yellow);
  }

  // Combinar: linhas preservadas + quebra dupla + mensagem fixa
  const resultado = preservedLines.join('\n') + '\n\n' + fixedMessage;
  const resultadoFinal = aplicarTransformacoes(resultado);

  logWithTime(`✅ Legenda editada criada com sucesso`, chalk.green);
  logWithTime(`📝 Resultado: "${resultadoFinal.substring(0, 100)}..."`, chalk.cyan);
  
  return resultadoFinal;
}
// === CORREÇÃO: FUNÇÃO PARA PROCESSAR EDIÇÃO (USANDO A FUNÇÃO CORRIGIDA) ===
async function processMessageEditingFixed(editKey) {
  logWithTime(`DEBUG: Entrei em processMessageEditing com editKey=${editKey}`, chalk.red);
  const editData = messageEditBuffer.get(editKey);
  if (!editData) {
    logWithTime(`⚠️ Dados de edição não encontrados para chave: ${editKey}`, chalk.yellow);
    return;
  }
  
  messageEditBuffer.delete(editKey);
  
  const { chatId, sentMessages, originalCaptions } = editData;
  
  logWithTime(`🔄 Iniciando processo de edição para ${sentMessages.length} mensagens`, chalk.cyan);
  logWithTime(`🔍 Legendas originais disponíveis: ${originalCaptions.length}`, chalk.blue);
  
  // Debug: mostrar todas as legendas originais
  originalCaptions.forEach((caption, index) => {
    logWithTime(`📝 Legenda original ${index}: "${(caption || 'VAZIO').substring(0, 50)}..."`, chalk.magenta);
  });
  
  try {
    // Para álbuns, editar apenas a primeira mensagem
    const firstMessage = sentMessages[0];
    const messageId = firstMessage.message?.message_id || firstMessage.message_id;
    
    if (!messageId) {
      logWithTime(`⚠️ ID da primeira mensagem não encontrado`, chalk.yellow);
      return;
    }
    
    // CORREÇÃO CRÍTICA: Usar a legenda original da primeira mensagem
    const legendaParaUsar = originalCaptions.find(
      caption => caption && caption.trim() !== "" && caption.trim().toUpperCase() !== "VAZIO..."
    ) || '';
    logWithTime(`🔍 Legenda original para edição: "${legendaParaUsar.substring(0, 100)}..."`, chalk.blue);

    // Usar a função corrigida para criar a legenda editada
    const editedCaption = createEditedCaptionFixed(legendaParaUsar, fixedMessage);
    if (editedCaption.trim() !== '') {
      try {
        await bot.editMessageCaption(editedCaption, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML'
        });
        
        logWithTime(`✅ Legenda editada com sucesso para mensagem ${messageId}`, chalk.green);
        logWithTime(`📝 Nova legenda aplicada: "${editedCaption.substring(0, 100)}..."`, chalk.cyan);
        
        if (sentMessages.length > 1) {
          logWithTime(`ℹ️ Álbum com ${sentMessages.length} mensagens - apenas a primeira foi editada`, chalk.blue);
        }
        
      } catch (editError) {
        logWithTime(`❌ Erro ao editar legenda da mensagem ${messageId}: ${editError.message}`, chalk.red);
        
        // Tentar novamente sem parse_mode se falhar
        try {
          await bot.editMessageCaption(editedCaption, {
            chat_id: chatId,
            message_id: messageId
          });
          logWithTime(`✅ Legenda editada sem parse_mode para mensagem ${messageId}`, chalk.green);
        } catch (secondError) {
          logWithTime(`❌ Falha definitiva ao editar mensagem ${messageId}: ${secondError.message}`, chalk.red);
        }
      }
    } else {
      logWithTime(`⚠️ Legenda editada vazia - não editando`, chalk.yellow);
    }
    
  } catch (error) {
    logWithTime(`❌ Erro durante processo de edição: ${error.message}`, chalk.red);
  }
}

// === CORREÇÃO: FUNÇÃO PARA AGENDAR EDIÇÃO (MELHORADO PARA DEBUG) ===
function scheduleMessageEditingFixed(chatId, sentMessages, originalCaptions) {
  logWithTime(`DEBUG: Entrando em scheduleMessageEditingFixed`, chalk.yellow);
  logWithTime(`DEBUG: isEditActive = ${isEditActive}`, chalk.yellow);
  logWithTime(`DEBUG: chatId = ${chatId}`, chalk.yellow);
  logWithTime(`DEBUG: sentMessages = ${JSON.stringify(sentMessages)}`, chalk.yellow);
  logWithTime(`DEBUG: originalCaptions = ${JSON.stringify(originalCaptions)}`, chalk.yellow);

  if (!isEditActive) {
    logWithTime(`⚠️ Edição desativada - não agendando edição`, chalk.yellow);
    return;
  }
  const editKey = `${chatId}_${Date.now()}`;
  
  const editData = {
    chatId: chatId,
    sentMessages: sentMessages,
    originalCaptions: originalCaptions,
    timestamp: Date.now()
  };
  
  messageEditBuffer.set(editKey, editData);
  
  logWithTime(`📅 Edição agendada para ${sentMessages.length} mensagens`, chalk.white);
  logWithTime(`⏰ Tempo de espera: ${EDIT_TIMEOUT/1000} segundos`, chalk.white);
  
  // Debug: mostrar legendas que serão usadas na edição
  originalCaptions.forEach((caption, index) => {
    logWithTime(`🧺 Legenda armazenada ${index}: "${(caption || 'VAZIO').substring(0, 50)}..."`, chalk.magenta);
  });
  
  // Agendar edição usando a função corrigida
  setTimeout(() => {
    processMessageEditingFixed(editKey);
  }, EDIT_TIMEOUT);
}

// === CORREÇÃO: ENVIO DE MÍDIA COM LEGENDA ORIGINAL (GARANTINDO ARMAZENAMENTO CORRETO) ===
async function enviarMidiaComLegendaOriginalFixed(filePath, originalCaption, destino, mediaType = null) {
  try {
    const tipo = mediaType || detectMediaType(filePath);
    
    // CORREÇÃO CRÍTICA: Garantir que a legenda original seja preservada exatamente como está
    const legendaOriginalPura = originalCaption ?? '';
    
    logWithTime(`📤 Enviando mídia`, chalk.blue);
    logWithTime(`📝 Legenda original preservada: "${legendaOriginalPura.substring(0, 50)}..."`, chalk.cyan);
    
    // Aplicar apenas transformações na legenda original (SEM adicionar mensagem fixa)
    const legendaComTransformacoes = aplicarTransformacoes(legendaOriginalPura);
    
    const options = {
      chat_id: destino,
      caption: legendaComTransformacoes,
      parse_mode: 'HTML'
    };

      let result;
      const fileOptions = getFileOptions(filePath);

      switch (tipo) {
        case 'photo':
          result = await bot.sendPhoto(destino, { source: filePath, ...fileOptions }, options);
          break;
        case 'video':
          result = await bot.sendVideo(destino, { source: filePath, ...fileOptions }, options);
          break;
        case 'audio':
          result = await bot.sendAudio(destino, { source: filePath, ...fileOptions }, options);
          break;
        default:
          result = await bot.sendDocument(destino, { source: filePath, ...fileOptions }, options);
      }

    // Limpar arquivo temporário
    try {
      await fs.unlink(filePath);
    } catch (e) {
      logWithTime(`⚠️ Erro ao deletar arquivo temporário: ${e.message}`, chalk.yellow);
    }

    logWithTime(`✅ Mídia enviada com legenda original preservada`, chalk.green);
    
    // RETORNAR TAMBÉM A LEGENDA ORIGINAL PARA GARANTIR CONSISTÊNCIA
    return { result, originalCaption: legendaOriginalPura };
  } catch (error) {
    logWithTime(`❌ Erro ao enviar mídia: ${error.message}`, chalk.red);
    try {
      await fs.unlink(filePath);
    } catch (e) {}
    return null;
  }
}

// === CORREÇÃO: ENVIO DE ÁLBUM COM LEGENDAS ORIGINAIS (VERSÃO CORRIGIDA) ===
async function enviarAlbumReenvioFixed(mensagens, destino_id) {
  if (!mensagens.length) return;

  // Extrair o albumKey da primeira mensagem
  const firstMsg = mensagens[0];
  const chatId = extractChatId(firstMsg);
  const albumKey = `${chatId}_${firstMsg.groupedId}`;

  // Verificar metadata
  const metadata = album_metadata.get(albumKey);
  if (!metadata) {
    logWithTime(`❌ Tentativa de envio de álbum sem metadata: ${albumKey}`, chalk.red);
    return;
  }

  try {
    // Marcar como em processamento
    metadata.isProcessing = true;
    metadata.attemptCount++;

    logWithTime(`📦 Preparando álbum para reenvio com ${mensagens.length} mensagens (Tentativa ${metadata.attemptCount})`, chalk.blue);

    if (albumContainsForbiddenPhrase(mensagens)) {
      logWithTime(`❌ ÁLBUM BLOQUEADO: Contém frase proibida`, chalk.red);
      cleanupAlbumResources(albumKey);
      return;
    }

    // Download das mídias e coleta das legendas originais
    const originalCaptions = [];
    const downloadPromises = mensagens.map((msg, index) => {
      if (mensagens_processadas.has(msg.id) || !msg.media) return Promise.resolve(null);
      const originalCaption = msg.caption || msg.message || '';
      originalCaptions[index] = originalCaption;
      const filename = `temp_${msg.id}_${index}_${Date.now()}.${getFileExtension(msg)}`;
      return downloadMediaWithRetry(msg, filename).then(filePath => {
        if (!filePath) return null;
        return {
          index,
          msg,
          filePath,
          type: detectMediaType(filePath),
          caption: originalCaption
        };
      });
    });

    const results = await Promise.all(downloadPromises);
    const validResults = results.filter(r => r !== null);

    if (validResults.length === 0) {
      logWithTime(`❌ Nenhuma mídia válida para envio no álbum ${albumKey}`, chalk.red);
      cleanupAlbumResources(albumKey);
      return;
    }

    // Monta o álbum já com a legenda editada na primeira mídia
    if (validResults.length > 1 && validResults.every(r => ['photo', 'video'].includes(r.type))) {
      // Usa a legenda original da primeira mensagem não vazia para montar a editada
      const legendaOriginalParaEditar = originalCaptions.find(c => c && c.trim() !== '') || '';
      const token = randomUUID();
      authorizationTokens.add(token);
      const legendaEditada = createEditedCaptionFixed(legendaOriginalParaEditar, fixedMessage) + `\n\n#auth_token:${token}`;

      const mediaItems = validResults.map((r, idx) => ({
        type: r.type,
        media: r.filePath,
        caption: idx === 0 ? legendaEditada : undefined,
        parse_mode: idx === 0 ? 'HTML' : undefined
      }));

      logWithTime(`📤 Enviando álbum já com legenda editada na primeira mídia`, chalk.green);
      await bot.sendMediaGroup(destino_id, mediaItems);

      logWithTime(`✅ Álbum enviado com sucesso: ${validResults.length} mídias`, chalk.green);
      cleanupAlbumResources(albumKey);
    } else {
      // Envia individualmente, já com legenda transformada/formatada
      for (const item of validResults) {
        const legendaEditada = createEditedCaptionFixed(item.caption, fixedMessage);
        await enviarMidiaComLegendaOriginalFixed(item.filePath, legendaEditada, destino_id, item.type);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      cleanupAlbumResources(albumKey);
    }

  } catch (error) {
    logWithTime(`❌ Erro ao processar álbum ${albumKey}: ${error.message}`, chalk.red);

    if (metadata.attemptCount < 3) {
      metadata.isProcessing = false;
      setTimeout(() => {
        const msgs = album_cache.get(albumKey);
        if (msgs) enviarAlbumReenvioFixed(msgs, destino_id);
      }, 5000);
    } else {
      cleanupAlbumResources(albumKey);
    }
  }
}

// Função auxiliar para limpeza
function cleanupAlbumResources(albumKey) {
  album_cache.delete(albumKey);
  album_metadata.delete(albumKey);
  const timeoutId = timeout_tasks.get(albumKey);
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeout_tasks.delete(albumKey);
  }
}
// === CORREÇÃO: ENVIO DE MÍDIA INDIVIDUAL (VERSÃO CORRIGIDA) ===
async function enviarMidiaIndividualFixed(mensagem, destino_id) {
  if (mensagens_processadas.has(mensagem.id)) return;
  
  const txt = (mensagem.caption ?? mensagem.message ?? '').toLowerCase();
  if (containsForbiddenPhrase(txt)) {
    logWithTime(`❌ Mensagem ${mensagem.id} contém frase proibida, ignorando...`, chalk.red);
    mensagens_processadas.add(mensagem.id);
    return;
  }

  if (!mensagem.media && mensagem.message) {
    try {
      // CORREÇÃO CRÍTICA: Para mensagens de texto, armazenar o texto original
      const textoOriginalPuro = mensagem.message;
      const textoComTransformacoes = aplicarTransformacoes(textoOriginalPuro);
      
      logWithTime(`💬 Enviando texto`, chalk.blue);
      logWithTime(`📝 Texto original: "${textoOriginalPuro.substring(0, 50)}..."`, chalk.cyan);
      
      const result = await bot.sendMessage(destino_id, textoComTransformacoes);
      mensagens_processadas.add(mensagem.id);
      
      if (isEditActive && result) {
        logWithTime(`📝 Agendando edição para mensagem de texto`, chalk.blue);
        // Passar o texto ORIGINAL para edição
        scheduleMessageEditingFixed(destino_id, [{ message: result }], [textoOriginalPuro]);
      }
      
      logWithTime(`✅ Mensagem de texto enviada`, chalk.green);
    } catch (error) {
      logWithTime(`❌ Erro ao enviar mensagem de texto: ${error.message}`, chalk.red);
    }
    return;
  }

  if (!mensagem.media) {
    logWithTime(`⚠️ Mensagem ${mensagem.id} sem mídia e sem texto, ignorando...`, chalk.yellow);
    mensagens_processadas.add(mensagem.id);
    return;
  }

  const filename = `temp_${mensagem.id}_${Date.now()}.${getFileExtension(mensagem)}`;
  const filePath = await downloadMedia(mensagem, filename);
  
  if (filePath) {
    // CORREÇÃO CRÍTICA: Armazenar a legenda original EXATAMENTE como está
    const originalCaptionPura = mensagem.caption ?? mensagem.message ?? '';
    
    logWithTime(`📤 Enviando mídia individual`, chalk.blue);
    logWithTime(`📝 Legenda original: "${originalCaptionPura.substring(0, 50)}..."`, chalk.cyan);
    
    // Enviar com legenda ORIGINAL (com transformações apenas)
    const sentResult = await enviarMidiaComLegendaOriginalFixed(filePath, originalCaptionPura, destino_id);
    
    if (sentResult && sentResult.result && isEditActive) {
      logWithTime(`📅 Agendando edição para mídia individual`, chalk.blue);
      // Passar a legenda ORIGINAL para edição
      scheduleMessageEditingFixed(destino_id, [{ message: sentResult.result }], [sentResult.originalCaption]);
    }
    
    mensagens_processadas.add(mensagem.id);
    logWithTime(`✅ Mídia individual enviada`, chalk.green);
  } else {
    logWithTime(`❌ Falha ao baixar mídia da mensagem ${mensagem.id}`, chalk.red);
  }
}

// === ATUALIZAR REFERENCIAS PARA USAR AS FUNÇÕES CORRIGIDAS ===
// Substituir as chamadas das funções antigas pelas novas versões corrigidas

// No handler de timeout do álbum:
async function album_timeout_handler_corrected(albumKey, destino) {
    const metadata = album_metadata.get(albumKey);
    if (!metadata) return;

    // 1. Se bloqueado, limpa tudo e sai
    if (albuns_bloqueados.has(albumKey)) {
        logWithTime(`⛔ Álbum ${albumKey} está bloqueado, descartando e limpando.`, chalk.red);
        albuns_bloqueados.delete(albumKey);
        album_cache.delete(albumKey);
        album_metadata.delete(albumKey);
        timeout_tasks.delete(albumKey);
        return;
    }

    // 2. Se não bloqueado, processa normalmente
    if (!metadata.isProcessing && !metadata.processingStarted && isAlbumComplete(albumKey)) {
        logWithTime(`🎯 Iniciando processamento do álbum ${albumKey}`, chalk.green);

        try {
            metadata.processingStarted = true;
            metadata.isProcessing = true;
            const messages = album_cache.get(albumKey) || [];
            await enviarAlbumReenvioFixed(messages, destino);
        } catch (error) {
            logWithTime(`❌ Erro ao processar álbum: ${error.message}`, chalk.red);
            metadata.isProcessing = false;
        } finally {
            // Limpeza final
            album_cache.delete(albumKey);
            timeout_tasks.delete(albumKey);
            album_metadata.delete(albumKey);
        }
    }
}
// No handler de timeout do buffer sem grupo:
async function buffer_sem_group_timeout_handler_corrected(chatId) {
  const msgs = buffer_sem_group.get(chatId) || [];
  buffer_sem_group.delete(chatId);
  buffer_sem_group_tasks.delete(chatId);

  if (msgs.length === 0) return;

  logWithTime(`☁️ Processando buffer sem grupo com ${msgs.length} mensagens (chatId: ${chatId})`, chalk.yellow);

  for (const msg of msgs) {
    const destino = PARES_REPASSE[chatId];
    if (destino) {
      try {
        await enviarMidiaIndividualFixed(msg, destino); // Usar a versão corrigida
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        logWithTime(`❌ Erro ao processar mensagem individual: ${error.message}`, chalk.red);
      }
    }
  }
}

// === EVENTO PRINCIPAL DE NOVA MENSAGEM (CORRIGIDO) ===
client.addEventHandler(async (event) => {
  const message = event.message;
  if (!message) return;

  try {
    const chatId = extractChatId(message);
    if (!chatId) return;

    const destino = PARES_REPASSE[chatId];
    if (!destino) return;
    if (message.groupedId) {
      const albumKey = `${chatId}_${message.groupedId}`;
      const txt = (message.caption ?? message.message ?? '').toLowerCase();

      // Checa se o álbum já está bloqueado, ignora qualquer mensagem nova desse álbum
      if (albuns_bloqueados.has(albumKey)) {
        logWithTime(`⛔ Ignorando mensagem, álbum ${albumKey} já está bloqueado.`, chalk.red);
        return;
      }

      // Se a mensagem for proibida, bloqueia o álbum e impede qualquer envio futuro dele
      if (containsForbiddenPhrase(txt)) {
        logWithTime(`❌ Mensagem de álbum contém frase proibida, bloqueando álbum ${albumKey}`, chalk.red);
        albuns_bloqueados.add(albumKey);

        // Remove o cache do álbum (se existir)
        if (album_cache.has(albumKey)) album_cache.delete(albumKey);

        // Cancela o timeout do álbum (se existir)
        if (timeout_tasks.has(albumKey)) {
          clearTimeout(timeout_tasks.get(albumKey));
          timeout_tasks.delete(albumKey);
        }
        return;
      }

      // Fluxo normal: apenas entra aqui se não está bloqueado e não contém frase proibida
      if (!album_metadata.has(albumKey)) {
        initializeAlbumMetadata(albumKey, message.groupedId);
        logWithTime(`📦 Novo álbum iniciado: ${albumKey}`, chalk.yellow);
      }

      const metadata = album_metadata.get(albumKey);

      // Atualizar cache e metadata
      if (!album_cache.has(albumKey)) {
        album_cache.set(albumKey, []);
      }

      const messages = album_cache.get(albumKey);
      if (!messages.some(m => m.id === message.id)) {
        messages.push(message);
        updateAlbumMetadata(albumKey, message);
      }

      // Cancelar timeout anterior se existir
      if (timeout_tasks.has(albumKey)) {
        clearTimeout(timeout_tasks.get(albumKey));
      }

      // Configurar novo timeout
      const timeoutId = setTimeout(async () => {
          await album_timeout_handler_corrected(albumKey, destino);
      }, ALBUM_TIMEOUT);

    timeout_tasks.set(albumKey, timeoutId);
    return;
}
    
    // ... resto do código para mensagens individuais ...

  } catch (error) {
    logWithTime(`❌ Erro no evento de nova mensagem: ${error.message}`, chalk.red);
  }
}, new NewMessage({}));

// Continuação do código do bot - comandos e funções restantes

// === COMANDOS DO BOT (CONTINUAÇÃO) ===
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const status = `
📊 *Status do Bot*

🪄 *Edição de texto:* ${isEditActive ? '✅ ATIVA' : '❌ INATIVA'}
⏰ *Timeout de Edição:* ${EDIT_TIMEOUT/1000}s
📦 *Timeout de Álbum:* ${ALBUM_TIMEOUT/1000}s
☁️ *Buffer Individual:* ${BUFFER_SEM_GROUP_TIMEOUT/1000}s

📝 *Mensagem Fixa:*
${fixedMessage ? `"${fixedMessage.substring(0, 100)}..."` : 'Não definida'}

💱 *Transformações:* ${transformations.size}
🚫 *Blacklist:* ${blacklist.size}

📊 *Estatísticas:*
• Mensagens processadas: ${mensagens_processadas.size}
• Álbuns em cache: ${album_cache.size}
• Buffers ativos: ${buffer_sem_group.size}
• Edições pendentes: ${messageEditBuffer.size}
  `;
  
  bot.sendMessage(chatId, status, { parse_mode: 'Markdown' });
});

bot.onText(/\/toggle_edit/, (msg) => {
  const chatId = msg.chat.id;
  isEditActive = !isEditActive;
  
  const status = isEditActive ? 'ATIVADA' : 'DESATIVADA';
  const emoji = isEditActive ? '✅' : '❌';
  
  bot.sendMessage(chatId, `${emoji} Edição de mensagens ${status}!`, { parse_mode: 'Markdown' });
  logWithTime(`🔄 Edição ${status} via comando`, chalk.cyan);
});

bot.onText(/\/set_message (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const newMessage = match[1];
  
  fixedMessage = newMessage;
  
  bot.sendMessage(chatId, `
✅ *Mensagem fixa definida:*

"${fixedMessage}"

ℹ️ Esta mensagem será adicionada após as duas primeiras linhas das legendas originais.
  `, { parse_mode: 'Markdown' });
  
  logWithTime(`📝 Nova mensagem fixa definida: "${fixedMessage.substring(0, 50)}..."`, chalk.green);
});

bot.onText(/\/get_message/, (msg) => {
  const chatId = msg.chat.id;
  
  if (fixedMessage) {
    bot.sendMessage(chatId, `
📝 *Mensagem fixa atual:*

"${fixedMessage}"
    `, { parse_mode: 'Markdown' });
  } else {
    bot.sendMessage(chatId, '❌ Nenhuma mensagem fixa definida.');
  }
});

bot.onText(/\/clear_message/, (msg) => {
  const chatId = msg.chat.id;
  fixedMessage = '';
  
  bot.sendMessage(chatId, '✅ Mensagem fixa removida!');
  logWithTime(`🗑️ Mensagem fixa removida via comando`, chalk.yellow);
});

bot.onText(/\/add_transform (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const input = match[1];
  
  // Formato esperado: "palavra_original -> palavra_nova"
  const parts = input.split(' -> ');
  if (parts.length !== 2) {
    bot.sendMessage(chatId, '❌ Formato incorreto. Use: `/add_transform palavra_original -> palavra_nova`', { parse_mode: 'Markdown' });
    return;
  }
  
  const [original, replacement] = parts.map(p => p.trim());
  transformations.set(original.toLowerCase(), replacement);
  
  bot.sendMessage(chatId, `
✅ *Transformação adicionada:*

"${original}" → "${replacement}"
  `, { parse_mode: 'Markdown' });
  
  logWithTime(`🔄 Nova transformação: "${original}" → "${replacement}"`, chalk.green);
});

bot.onText(/\/list_transforms/, (msg) => {
  const chatId = msg.chat.id;
  
  if (transformations.size === 0) {
    bot.sendMessage(chatId, '❌ Nenhuma transformação configurada.');
    return;
  }
  
  let list = '🔄 *Transformações ativas:*\n\n';
  let index = 1;
  
  for (const [original, replacement] of transformations) {
    list += `${index}. "${original}" → "${replacement}"\n`;
    index++;
  }
  
  bot.sendMessage(chatId, list, { parse_mode: 'Markdown' });
});

bot.onText(/\/remove_transform (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const palavra = match[1].trim().toLowerCase();
  
  if (transformations.has(palavra)) {
    const replacement = transformations.get(palavra);
    transformations.delete(palavra);
    
    bot.sendMessage(chatId, `
✅ *Transformação removida:*

"${palavra}" → "${replacement}"
    `, { parse_mode: 'Markdown' });
    
    logWithTime(`🗑️ Transformação removida: "${palavra}"`, chalk.yellow);
  } else {
    bot.sendMessage(chatId, `❌ Transformação "${palavra}" não encontrada.`);
  }
});

bot.onText(/\/add_blacklist (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const phrase = match[1].trim().toLowerCase();
  
  blacklist.add(phrase);
  
  bot.sendMessage(chatId, `
✅ *Frase adicionada à blacklist:*

"${phrase}"

⚠️ Mensagens contendo esta frase serão bloqueadas.
  `, { parse_mode: 'Markdown' });
  
  logWithTime(`🚫 Nova frase na blacklist: "${phrase}"`, chalk.red);
});

bot.onText(/\/list_blacklist/, (msg) => {
  const chatId = msg.chat.id;
  
  if (blacklist.size === 0) {
    bot.sendMessage(chatId, '✅ Blacklist vazia.');
    return;
  }
  
  let list = '🚫 *Frases bloqueadas:*\n\n';
  let index = 1;
  
  for (const phrase of blacklist) {
    list += `${index}. "${phrase}"\n`;
    index++;
  }
  
  bot.sendMessage(chatId, list, { parse_mode: 'Markdown' });
});

bot.onText(/\/remove_blacklist (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const phrase = match[1].trim().toLowerCase();
  
  if (blacklist.has(phrase)) {
    blacklist.delete(phrase);
    
    bot.sendMessage(chatId, `
✅ *Frase removida da blacklist:*

"${phrase}"
    `, { parse_mode: 'Markdown' });
    
    logWithTime(`🗑️ Frase removida da blacklist: "${phrase}"`, chalk.yellow);
  } else {
    bot.sendMessage(chatId, `❌ Frase "${phrase}" não encontrada na blacklist.`);
  }
});

bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;
  
  const stats = `
📊 *Estatísticas Detalhadas*

📈 *Processamento:*
• Mensagens processadas: ${mensagens_processadas.size}
• Álbuns em cache: ${album_cache.size}
• Buffers individuais: ${buffer_sem_group.size}
• Edições pendentes: ${messageEditBuffer.size}
• Timeouts ativos: ${timeout_tasks.size}

⚙️ *Configuração:*
• Transformações: ${transformations.size}
• Frases bloqueadas: ${blacklist.size}
• Edição: ${isEditActive ? 'Ativa' : 'Inativa'}
• Mensagem fixa: ${fixedMessage ? 'Definida' : 'Não definida'}

⏰ *Timeouts:*
• Álbum: ${ALBUM_TIMEOUT/1000}s
• Buffer individual: ${BUFFER_SEM_GROUP_TIMEOUT/1000}s
• Edição: ${EDIT_TIMEOUT/1000}s

💾 *Memória:*
• Uptime: ${Math.floor(process.uptime())}s
• Uso de memória: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
  `;
  
  bot.sendMessage(chatId, stats, { parse_mode: 'Markdown' });
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `
🤖 *Ajuda - Bot de Repasse*

📝 *Como funciona:*
1. O bot recebe mensagens dos chats configurados
2. Aplica transformações de texto conforme configurado
3. Envia para os destinos com legendas editadas
4. Preserva as duas primeiras linhas originais
5. Adiciona a mensagem fixa ao final

🔧 *Configuração Principal:*
• \`/toggle_edit\` - Liga/desliga edição automática
• \`/set_message [texto]\` - Define mensagem fixa
• \`/status\` - Ver configuração atual

🔄 *Transformações:*
• \`/add_transform palavra -> nova_palavra\`
• \`/list_transforms\` - Ver todas
• \`/remove_transform palavra\`

🚫 *Blacklist:*
• \`/add_blacklist frase_proibida\`
• \`/list_blacklist\` - Ver todas
• \`/remove_blacklist frase\`

📊 *Monitoramento:*
• \`/stats\` - Estatísticas detalhadas
• \`/get_message\` - Ver mensagem fixa atual

⚠️ *Importante:*
• Transformações são case-insensitive
• Blacklist bloqueia mensagens completamente
• Edição preserva 2 primeiras linhas originais
• Mensagem fixa é adicionada após linha em branco
  `, { parse_mode: 'Markdown' });
});

// === COMANDO PARA DEBUG E LIMPEZA ===
bot.onText(/\/clear_cache/, (msg) => {
  const chatId = msg.chat.id;
  
  // Limpar todos os caches e buffers
  const albumCount = album_cache.size;
  const bufferCount = buffer_sem_group.size;
  const editCount = messageEditBuffer.size;
  const timeoutCount = timeout_tasks.size;
  
  // Cancelar todos os timeouts
  for (const timeoutId of timeout_tasks.values()) {
    clearTimeout(timeoutId);
  }
  for (const timeoutId of buffer_sem_group_tasks.values()) {
    clearTimeout(timeoutId);
  }
  
  // Limpar mapas
  album_cache.clear();
  buffer_sem_group.clear();
  messageEditBuffer.clear();
  timeout_tasks.clear();
  buffer_sem_group_tasks.clear();
  
  bot.sendMessage(chatId, `
🧹 *Cache limpo com sucesso!*

📊 *Itens removidos:*
• Álbuns em cache: ${albumCount}
• Buffers individuais: ${bufferCount}
• Edições pendentes: ${editCount}
• Timeouts cancelados: ${timeoutCount}

✅ Sistema resetado e pronto para uso.
  `, { parse_mode: 'Markdown' });
  
  logWithTime(`🧹 Cache limpo via comando - ${albumCount + bufferCount + editCount} itens removidos`, chalk.cyan);
});

// === COMANDO PARA TESTAR TRANSFORMAÇÕES ===
bot.onText(/\/test_transform (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const testText = match[1];
  
  const transformed = aplicarTransformacoes(testText);
  
  bot.sendMessage(chatId, `
🧪 *Teste de Transformações*

📝 *Texto original:*
"${testText}"

🔄 *Texto transformado:*
"${transformed}"

${testText === transformed ? '✅ Nenhuma transformação aplicada' : '🔄 Transformações aplicadas'}
  `, { parse_mode: 'Markdown' });
});

// === COMANDO PARA TESTAR EDIÇÃO DE LEGENDA ===
bot.onText(/\/test_caption (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const testCaption = match[1];
  
  if (!fixedMessage) {
    bot.sendMessage(chatId, '❌ Defina uma mensagem fixa primeiro com `/set_message`', { parse_mode: 'Markdown' });
    return;
  }
  
  const editedCaption = createEditedCaptionFixed(testCaption, fixedMessage);
  
  bot.sendMessage(chatId, `
🧪 *Teste de Edição de Legenda*

📝 *Legenda original:*
"${testCaption}"

✏️ *Legenda editada:*
"${editedCaption}"

ℹ️ *Processo:*
• Preservadas as 2 primeiras linhas com conteúdo
• Adicionada linha em branco
• Anexada mensagem fixa
• Aplicadas transformações
  `, { parse_mode: 'Markdown' });
});

// === HANDLERS DE ERRO E LIMPEZA ===
process.on('SIGINT', async () => {
  logWithTime('🛑 Solicitação de encerramento do bot detectado, encerrando...', chalk.red);
  
  // Cancelar todos os timeouts
  for (const timeoutId of timeout_tasks.values()) {
    clearTimeout(timeoutId);
  }
  for (const timeoutId of buffer_sem_group_tasks.values()) {
    clearTimeout(timeoutId);
  }
  
  // Processar álbuns pendentes
  if (album_cache.size > 0) {
    logWithTime(`🔄 Processando ${album_cache.size} álbuns pendentes...`, chalk.blue);
    
    for (const [albumKey, msgs] of album_cache) {
      if (msgs.length > 0) {
        const chatId = albumKey.split('_')[0];
        const destino = PARES_REPASSE[chatId];
        if (destino) {
          try {
            await enviarAlbumReenvioFixed(msgs, destino);
          } catch (error) {
            logWithTime(`❌ Erro ao processar álbum pendente: ${error.message}`, chalk.red);
          }
        }
      }
    }
  }
  
  // Processar buffers pendentes
  if (buffer_sem_group.size > 0) {
    logWithTime(`🔄 Processando ${buffer_sem_group.size} buffers pendentes...`, chalk.blue);
    
    for (const [chatId, msgs] of buffer_sem_group) {
      const destino = PARES_REPASSE[chatId];
      if (destino && msgs.length > 0) {
        for (const msg of msgs) {
          try {
            await enviarMidiaIndividualFixed(msg, destino);
          } catch (error) {
            logWithTime(`❌ Erro ao processar mensagem pendente: ${error.message}`, chalk.red);
          }
        }
      }
    }
  }
  
  logWithTime('✅ Limpeza concluída, encerrando aplicação...', chalk.green);
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  logWithTime(`❌ Unhandled Rejection at: ${promise}, reason: ${reason}`, chalk.red);
});

process.on('uncaughtException', (error) => {
  logWithTime(`❌ Uncaught Exception: ${error.message}`, chalk.red);
  logWithTime(`Stack: ${error.stack}`, chalk.red);
});

// === INICIALIZAÇÃO E LOGS DE STARTUP ===
async function iniciarBot() {
  try {
    logWithTime('🚀 Iniciando bot de repasse...', chalk.cyan);
    
    // Verificar configurações essenciais
    if (Object.keys(PARES_REPASSE).length === 0) {
      logWithTime('⚠️ Nenhum par de repasse configurado!', chalk.yellow);
    } else {
      logWithTime(`📋 ${Object.keys(PARES_REPASSE).length} pares de repasse configurados`, chalk.blue);
      for (const [origem, destino] of Object.entries(PARES_REPASSE)) {
        logWithTime(`ℹ️  ${origem} → ${destino}`, chalk.blue);
      }
    }
    
    // Conectar cliente Telegram
    logWithTime('🔵 Conectando ao Telegram...', chalk.blue);
    await client.start({
      phoneNumber: async () => await input.text('Digite seu número de telefone: '),
      password: async () => await input.text('Digite sua senha: '),
      phoneCode: async () => await input.text('Digite o código recebido: '),
      onError: (err) => logWithTime(`❌ Erro de conexão: ${err.message}`, chalk.red),
    });
    
    logWithTime('👤 Cliente Telegram conectado!', chalk.green);
    
    // Inicializar bot
    logWithTime('🤖 Inicializando bot de edição de legenda...', chalk.blue);
    
    // Configuração inicial
    logWithTime(`✏️  Edição: ${isEditActive ? 'ATIVA' : 'INATIVA'}`, chalk.green);
    logWithTime(`📌 Mensagem fixa: ${fixedMessage ? 'DEFINIDA' : 'NÃO DEFINIDA'}`, chalk.cyan);
    logWithTime(`💱 Transformações: ${transformations.size}`, chalk.cyan);
    logWithTime(`🚫 Blacklist: ${blacklist.size}`, chalk.cyan);
    
    // Timeouts configurados
    logWithTime(`⏰ Timeout álbum: ${ALBUM_TIMEOUT/1000}s`, chalk.cyan);
    logWithTime(`⏰ Timeout buffer: ${BUFFER_SEM_GROUP_TIMEOUT/1000}s`, chalk.cyan);
    logWithTime(`⏰ Timeout edição: ${EDIT_TIMEOUT/1000}s`, chalk.cyan);
    
    logWithTime('🔛 Bot iniciado com sucesso!', chalk.green);
    logWithTime('📱 Aguardando mensagens...', chalk.blue);
    
  } catch (error) {
    logWithTime(`❌ Erro na inicialização: ${error.message}`, chalk.red);
    logWithTime(`Stack: ${error.stack}`, chalk.red);
    process.exit(1);
  }
}

// === FUNÇÃO DE MONITORAMENTO ===
function iniciarMonitoramento() {
  setInterval(() => {
    const stats = {
      albums: album_cache.size,
      buffers: buffer_sem_group.size,
      edits: messageEditBuffer.size,
      timeouts: timeout_tasks.size,
      processed: mensagens_processadas.size,
      memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      uptime: Math.floor(process.uptime())
    };
    
    if (stats.albums > 0 || stats.buffers > 0 || stats.edits > 0) {
      logWithTime(`📊 Status: ${stats.albums} álbuns, ${stats.buffers} buffers, ${stats.edits} edições, ${stats.memory}MB`, chalk.blue);
    }
    
    // Limpeza de mensagens antigas (opcional)
    if (mensagens_processadas.size > 10000) {
      mensagens_processadas.clear();
      logWithTime('🧹 Cache de mensagens processadas limpo', chalk.yellow);
    }
    
  }, 60000); // A cada minuto
}
//=== LIMPEZA DE ÁLBUNS ORFÃOS ===
function cleanupStaleAlbums() {
  const now = Date.now();

  for (const [albumKey, metadata] of album_metadata.entries()) {
    const timeElapsed = now - metadata.lastUpdateTime;
    if (timeElapsed > ALBUM_TIMEOUT * 3) {
      logWithTime(`🧹 Removendo álbum órfão: ${albumKey}`, chalk.yellow);
      album_cache.delete(albumKey);
      album_metadata.delete(albumKey);
      if (timeout_tasks.has(albumKey)) {
        clearTimeout(timeout_tasks.get(albumKey));
        timeout_tasks.delete(albumKey);
      }
    }
  }
}
setInterval(cleanupStaleAlbums, ALBUM_TIMEOUT);

// === EXECUÇÃO PRINCIPAL ===
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  console.log('🚀 Iniciando bot...');
  iniciarBot();
  iniciarMonitoramento();
  monitorActiveAlbums();
}
// === EXPORTS (SE FOR MÓDULO) ===
export {
  client,
  bot,
  enviarAlbumReenvioFixed,
  enviarMidiaIndividualFixed,
  createEditedCaptionFixed,
  scheduleMessageEditingFixed,
  aplicarTransformacoes,
  containsForbiddenPhrase,
  logWithTime
};



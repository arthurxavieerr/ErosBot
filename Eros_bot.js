const oldWrite = process.stdout.write;
const unwantedLogPatterns = [
  /\[INFO\] - \[Running gramJS version/,
  /\[Connecting to \d+\.\d+\.\d+\.\d+:\d+\/TCPFull\.\.\.\]/,
  /\[Connection to \d+\.\d+\.\d+\.\d+:\d+\/TCPFull complete!\]/,
  /\[Using LAYER \d+ for initial connect\]/,
];

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
  maxConcurrentDownloads: 1
});

let isEditActive = true; // Ativado por padrão
let fixedMessage = loadFixedMessage();
let transformacoes = loadJSON(TRANSFORM_PATH, {});
let blacklist = loadJSON(BLACKLIST_PATH, []);
if (!Array.isArray(blacklist)) blacklist = [];

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Buffers e controle
const album_cache = new Map();
const timeout_tasks = new Map();
const buffer_sem_group = new Map();
const buffer_sem_group_tasks = new Map();
const mensagens_processadas = new Set();
const messageEditBuffer = new Map();

// === CRIAR PASTA DE DOWNLOADS ===
if (!fsSync.existsSync(DOWNLOADS_PATH)) {
  fsSync.mkdirSync(DOWNLOADS_PATH, { recursive: true });
}

// === UTILITÁRIOS ===
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
    logWithTime(`⬇️  Baixando mídia: ${filename}`, chalk.yellow);
    
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

// === ENVIO DE ÁLBUM COM LEGENDAS ORIGINAIS (CORRIGIDO) ===
async function enviarAlbumReenvio(mensagens, destino_id) {
  if (!mensagens.length) return;

  logWithTime(`📦 Preparando álbum para reenvio com ${mensagens.length} mensagens`, chalk.blue);
  
  if (albumContainsForbiddenPhrase(mensagens)) {
    logWithTime(`❌ ÁLBUM BLOQUEADO: Contém frase proibida. Nenhuma mensagem será enviada.`, chalk.red);
    for (const m of mensagens) {
      mensagens_processadas.add(m.id);
    }
    return;
  }

  mensagens.sort((a, b) => a.id - b.id);
  
  const downloadPromises = [];
  const validMessages = [];
  const originalCaptions = [];
  
  for (const [index, msg] of mensagens.entries()) {
    if (mensagens_processadas.has(msg.id)) continue;
    
    if (!msg.media) {
      logWithTime(`⚠️ Mensagem ${msg.id} sem mídia, pulando...`, chalk.yellow);
      continue;
    }

    validMessages.push(msg);
    
    // CRÍTICO: Armazenar a legenda original SEM modificações
    const legendaOriginal = msg.caption ?? msg.message ?? '';
    originalCaptions.push(legendaOriginal);
    logWithTime(`📝 Armazenando legenda original ${index}: "${legendaOriginal.substring(0, 50)}..."`, chalk.cyan);
    
    const filename = `temp_${msg.id}_${index}_${Date.now()}.${getFileExtension(msg)}`;
    
    const downloadPromise = downloadMediaWithRetry(msg, filename).then(filePath => {
      if (filePath) {
        const mediaType = detectMediaType(filePath);
        const mediaItem = {
          type: mediaType === 'photo' ? 'photo' : (mediaType === 'video' ? 'video' : 'document'),
          media: filePath
        };

        return { 
          messageId: msg.id, 
          mediaItem, 
          filePath, 
          originalCaption: legendaOriginalPura // Garantir que seja a legenda original
        };
      }
      return null;
    });
    downloadPromises.push(downloadPromise);
    mensagens_processadas.add(msg.id);
  }

  if (downloadPromises.length === 0) {
    logWithTime('❌ Nenhuma mídia válida encontrada no álbum', chalk.red);
    return;
  }

  const results = await Promise.all(downloadPromises);
  const validResults = results.filter(r => r !== null);

  // NOVA CHECAGEM: só envie se TODAS as mídias foram baixadas!
  if (validResults.length !== mensagens.length) {
    logWithTime(
      `❌ [FALHA DE ÁLBUM] Envio abortado: mídias baixadas (${validResults.length}) < esperado (${mensagens.length}).`,
      chalk.red
    );
    // Opcional: colocar o álbum de volta no cache para tentar novamente depois
    // album_cache.set(albumKey, mensagens);
    return;
  }
  try {
    if (validResults.length > 1 && validResults.every(r => ['photo', 'video'].includes(r.mediaItem.type))) {
      // Pegue a primeira legenda não-vazia do álbum (de qualquer posição!)
      // Antes de mapear os mediaItems, defina a legenda a ser usada:
      const legendaParaUsar = originalCaptionsArray.find(
        caption => caption && caption.trim() !== ""
      ) || "";
      // Em seguida, construa mediaItems, aplicando a legenda só no primeiro item:
      const mediaItems = validResults.map((r, idx) => {
        const item = {
          type: r.mediaItem.type,
          media: r.mediaItem.media
        };
        if (idx === 0 && legendaParaUsar) {
          item.caption = aplicarTransformacoes(legendaParaUsar);
          item.parse_mode = 'HTML';
          logWithTime(`📝  Primeira mídia do álbum terá legenda:`, chalk.cyan);
          logWithTime(`🪧  "${item.caption.substring(0, 100)}..."`, chalk.magenta);
        }
        return item;
      });
      // ...
      logWithTime(`📤 Enviando álbum com ${mediaItems.length} mídias`, chalk.green);
      
      const result = await bot.sendMediaGroup(destino_id, mediaItems);
      
      if (isEditActive && result && result.length > 0) {
        logWithTime(`📝 Agendando edição para álbum - Legendas originais: ${originalCaptions.length}`, chalk.blue);
        scheduleMessageEditing(destino_id, result, originalCaptions);
      }
      
      logWithTime(`✅ Álbum enviado com sucesso`, chalk.green);
      
    } else {
      logWithTime(`📤 Enviando ${validResults.length} mídias individualmente`, chalk.yellow);
      
      const sentMessages = [];
      for (const [index, result] of validResults.entries()) {
        const originalCaption = originalCaptions[index] || '';
        logWithTime(`📤 Enviando mídia individual ${index + 1} com legenda original: "${originalCaption.substring(0, 50)}..."`, chalk.blue);
        
        const sentMsg = await enviarMidiaComLegendaOriginal(result.filePath, originalCaption, destino_id, result.mediaItem.type);
        
        if (sentMsg) {
          sentMessages.push({ message: sentMsg });
        }
        
        if (index < validResults.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      if (isEditActive && sentMessages.length > 0) {
        logWithTime(`📝 Agendando edição para ${sentMessages.length} mensagens individuais`, chalk.blue);
        scheduleMessageEditing(destino_id, sentMessages, originalCaptions);
      }
      
      logWithTime(`✅ Todas as mídias enviadas individualmente`, chalk.green);
    }
    
    // Limpar arquivos temporários
    for (const result of validResults) {
      try {
        await fs.unlink(result.filePath);
      } catch (e) {
        logWithTime(`⚠️ Erro ao deletar arquivo temporário: ${e.message}`, chalk.yellow);
      }
    }
    
  } catch (error) {
    logWithTime(`❌ Erro ao enviar álbum: ${error.message}`, chalk.red);
    
    logWithTime('🔄 Tentando envio individual como fallback...', chalk.yellow);
    
    const sentMessages = [];
    for (const [index, result] of validResults.entries()) {
      try {
        const originalCaption = originalCaptions[index] || '';
        const sentMsg = await enviarMidiaComLegendaOriginal(result.filePath, originalCaption, destino_id);
        if (sentMsg) {
          sentMessages.push({ message: sentMsg });
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (individualErr) {
        logWithTime(`❌ Erro ao enviar mídia individual: ${individualErr.message}`, chalk.red);
      }
    }
    
    if (isEditActive && sentMessages.length > 0) {
      scheduleMessageEditing(destino_id, sentMessages, originalCaptions);
    }
    
    // Limpar arquivos temporários do fallback
    for (const result of validResults) {
      try {
        await fs.unlink(result.filePath);
      } catch (e) {}
    }
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

// Continuação da função album_timeout_handler
async function album_timeout_handler(albumKey, destino) {
  const msgs = album_cache.get(albumKey) || [];
  album_cache.delete(albumKey);
  timeout_tasks.delete(albumKey);

  if (msgs.length === 0) return;

  logWithTime(`📦 Processando álbum com ${msgs.length} mensagens (albumKey: ${albumKey})`, chalk.blue);
  
  try {
    await enviarAlbumReenvio(msgs, destino);
  } catch (error) {
    logWithTime(`❌ Erro no processamento do álbum: ${error.message}`, chalk.red);
  }
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

  logWithTime(`📦 Preparando álbum para reenvio com ${mensagens.length} mensagens`, chalk.blue);

  if (albumContainsForbiddenPhrase(mensagens)) {
    logWithTime(`❌ ÁLBUM BLOQUEADO: Contém frase proibida. Nenhuma mensagem será enviada.`, chalk.red);
    for (const m of mensagens) {
      mensagens_processadas.add(m.id);
    }
    return;
  }

  mensagens.sort((a, b) => a.id - b.id);

  // Monta as promises de download preservando o índice original
  const downloadPromises = mensagens.map((msg, index) => {
    if (mensagens_processadas.has(msg.id) || !msg.media) {
      return Promise.resolve(null);
    }
    const filename = `temp_${msg.id}_${index}_${Date.now()}.${getFileExtension(msg)}`;
    const legendaOriginalPura = msg.caption ?? msg.message ?? '';
    logWithTime(`🧺  Armazenando legenda original ${index}:`, chalk.cyan);
    logWithTime(`    "${legendaOriginalPura.substring(0, 100)}..."`, chalk.magenta);
    return downloadMediaWithRetry(msg, filename).then(filePath => ({
      index,
      msg,
      filePath,
      originalCaption: legendaOriginalPura
    }));
  });

  const results = await Promise.all(downloadPromises);

  // Filtra só os downloads válidos e preserva o índice
  const validResults = results.filter(r => r && r.filePath);

  // Só envie se TODAS as mídias foram baixadas (considerando apenas mensagens com mídia e não processadas)
  const expectedCount = mensagens.filter(m => m.media && !mensagens_processadas.has(m.id)).length;
  if (validResults.length !== expectedCount) {
    logWithTime(
      `❌ [FALHA DE ÁLBUM] Envio abortado: mídias baixadas (${validResults.length}) < esperado (${expectedCount}).`,
      chalk.red
    );
    // Limpa arquivos baixados
    for (const r of validResults) {
      try { await fs.unlink(r.filePath); } catch (e) {}
    }
    return;
  }

  // Ordena pelo índice original para garantir a ordem correta do álbum
  validResults.sort((a, b) => a.index - b.index);

  // Marca todas as mensagens como processadas
  for (const r of validResults) {
    mensagens_processadas.add(r.msg.id);
  }

  // Monta array de legendas originais para edição posterior
  const originalCaptionsArray = validResults.map(r => r.originalCaption);

  logWithTime(`🫙 Legendas originais coletadas para o álbum:`, chalk.blue);
  originalCaptionsArray.forEach((caption, index) => {
    logWithTime(`    ${index}: "${(caption || 'VAZIO').substring(0, 50)}..."`, chalk.magenta);
  });

  try {
    if (validResults.length > 1 && validResults.every(r => ['photo', 'video'].includes(detectMediaType(r.filePath)))) {
      // Pega a primeira legenda não-vazia
      const legendaParaUsar = originalCaptionsArray.find(
        caption => caption && caption.trim() !== ""
      ) || "";

      // Monta os mediaItems na ordem correta e só o primeiro recebe legenda
      const mediaItems = validResults.map((r, idx) => {
        const type = detectMediaType(r.filePath);
        const item = {
          type: type === 'photo' ? 'photo'
               : type === 'video' ? 'video'
               : 'document',
          media: r.filePath
        };
        if (idx === 0 && legendaParaUsar) {
          item.caption = aplicarTransformacoes(legendaParaUsar);
          item.parse_mode = 'HTML';
          logWithTime(`📝  Primeira mídia do álbum terá legenda:`, chalk.cyan);
          logWithTime(`🪧  "${item.caption.substring(0, 100)}..."`, chalk.magenta);
        }
        return item;
      });

      logWithTime(`📤 Enviando álbum com ${mediaItems.length} mídias`, chalk.green);

      const result = await bot.sendMediaGroup(destino_id, mediaItems);

      if (isEditActive && result && result.length > 0) {
        logWithTime(`📝 Agendando edição para álbum`, chalk.blue);
        logWithTime(`🔍 Legendas que serão usadas na edição:`, chalk.blue);
        originalCaptionsArray.forEach((caption, index) => {
          logWithTime(`    ${index}: "${(caption || 'VAZIO').substring(0, 50)}..."`, chalk.magenta);
        });
        scheduleMessageEditingFixed(destino_id, result, originalCaptionsArray);
      }

      logWithTime(`✅ Álbum enviado com sucesso`, chalk.green);

    } else {
      logWithTime(`📤 Enviando ${validResults.length} mídias individualmente`, chalk.yellow);

      const sentMessages = [];
      const sentOriginalCaptions = [];

      for (const [index, result] of validResults.entries()) {
        const originalCaption = originalCaptionsArray[index] || '';
        logWithTime(`📤  Enviando mídia individual ${index + 1}:`, chalk.blue);
        logWithTime(`    Legenda original: "${originalCaption.substring(0, 50)}..."`, chalk.cyan);
        const sentResult = await enviarMidiaComLegendaOriginalFixed(
          result.filePath,
          originalCaption,
          destino_id,
          detectMediaType(result.filePath)
        );
        if (sentResult && sentResult.result) {
          sentMessages.push({ message: sentResult.result });
          sentOriginalCaptions.push(sentResult.originalCaption);
        }
        if (index < validResults.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      if (isEditActive && sentMessages.length > 0) {
        logWithTime(`📝 Agendando edição para ${sentMessages.length} mensagens individuais`, chalk.blue);
        scheduleMessageEditingFixed(destino_id, sentMessages, sentOriginalCaptions);
      }

      logWithTime(`✅ Todas as mídias enviadas individualmente`, chalk.green);
    }

    // Limpa arquivos temporários
    for (const r of validResults) {
      try { await fs.unlink(r.filePath); } catch (e) {
        logWithTime(`⚠️ Erro ao deletar arquivo temporário: ${e.message}`, chalk.yellow);
      }
    }

  } catch (error) {
    logWithTime(`❌ Erro ao enviar álbum: ${error.message}`, chalk.red);

    logWithTime('🔄 Tentando envio individual como fallback...', chalk.yellow);

    const sentMessages = [];
    const sentOriginalCaptions = [];

    for (const [index, result] of validResults.entries()) {
      try {
        const originalCaption = originalCaptionsArray[index] || '';
        const sentResult = await enviarMidiaComLegendaOriginalFixed(result.filePath, originalCaption, destino_id);
        if (sentResult && sentResult.result) {
          sentMessages.push({ message: sentResult.result });
          sentOriginalCaptions.push(sentResult.originalCaption);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (individualErr) {
        logWithTime(`❌ Erro ao enviar mídia individual: ${individualErr.message}`, chalk.red);
      }
    }

    if (isEditActive && sentMessages.length > 0) {
      scheduleMessageEditingFixed(destino_id, sentMessages, sentOriginalCaptions);
    }

    // Limpa arquivos temporários do fallback
    for (const r of validResults) {
      try {
        await fs.unlink(r.filePath);
      } catch (e) {}
    }
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
  const msgs = album_cache.get(albumKey) || [];
  album_cache.delete(albumKey);
  timeout_tasks.delete(albumKey);

  if (msgs.length === 0) return;

  logWithTime(`📦 Processando álbum com ${msgs.length} mensagens (albumKey: ${albumKey})`, chalk.blue);
  
  try {
    await enviarAlbumReenvioFixed(msgs, destino); // Usar a versão corrigida
  } catch (error) {
    logWithTime(`❌ Erro no processamento do álbum: ${error.message}`, chalk.red);
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
        const txt = (message.caption ?? message.message ?? '').toLowerCase();/////// FILTRO MENSAGENS PROIBIDAS//////////
    if (containsForbiddenPhrase(txt)) {     /////////////////////////////////////////////////////////////////////////////
      logWithTime(`❌ Mensagem recebida contém frase proibida, ignorando COMPLETAMENTE`, chalk.red);  ///////////////////
      mensagens_processadas.add(message.id);  ////////////////////////////////////////////////////////////////////////////
      return; ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    } ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    logWithTime(`🔔 Nova mensagem recebida de ${chatId}`, chalk.yellow);

    // Verificar se é álbum
    if (message.groupedId) {
        // FILTRO PARA ÁLBUM:
      const txt = (message.caption ?? message.message ?? '').toLowerCase();
      if (containsForbiddenPhrase(txt)) {
        logWithTime(`❌ Mensagem de álbum contém frase proibida, ignorando COMPLETAMENTE`, chalk.red);
        mensagens_processadas.add(message.id);
        return; // NÃO adiciona ao album_cache
      }
      // FILTRO TERMINA
      const albumKey = `${chatId}_${message.groupedId}`;
      
      if (!album_cache.has(albumKey)) {
        album_cache.set(albumKey, []);
      }
      
      album_cache.get(albumKey).push(message);
      
      // Cancelar timeout anterior se existir
      if (timeout_tasks.has(albumKey)) {
        clearTimeout(timeout_tasks.get(albumKey));
      }
      
      // Definir novo timeout
      const timeoutId = setTimeout(() => {
        album_timeout_handler_corrected(albumKey, destino); // Usar versão corrigida
      }, ALBUM_TIMEOUT);
      
      timeout_tasks.set(albumKey, timeoutId);
      
      logWithTime(`📦 Mensagem adicionada ao álbum ${albumKey} (${album_cache.get(albumKey).length} mensagens)`, chalk.yellow);
      
    } else {
      // Mensagem individual
      if (!buffer_sem_group.has(chatId)) {
        buffer_sem_group.set(chatId, []);
      }
      
      buffer_sem_group.get(chatId).push(message);
      
      // Cancelar timeout anterior se existir
      if (buffer_sem_group_tasks.has(chatId)) {
        clearTimeout(buffer_sem_group_tasks.get(chatId));
      }
      
      // Definir novo timeout
      const timeoutId = setTimeout(() => {
        buffer_sem_group_timeout_handler_corrected(chatId); // Usar versão corrigida
      }, BUFFER_SEM_GROUP_TIMEOUT);
      
      buffer_sem_group_tasks.set(chatId, timeoutId);
      
      logWithTime(`📝 Mensagem individual adicionada ao buffer (${buffer_sem_group.get(chatId).length} mensagens)`, chalk.yellow);
    }
    
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

// === EXECUÇÃO PRINCIPAL ===
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  console.log('🚀 Iniciando bot...');
  iniciarBot();
  iniciarMonitoramento();
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



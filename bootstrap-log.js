import log4js from 'log4js';

// Silencia todos os logs do log4js, inclusive do gramjs
log4js.configure({
  appenders: { out: { type: 'stdout' } },
  categories: { default: { appenders: ['out'], level: 'error' } } // só mostra erros
});
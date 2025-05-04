const express = require('express');
const { performTikTokActions } = require('./tiktok');
const { PORT } = require('./config');
const fs = require('fs');
const path = require('path');

// Inicializar app
const app = express();
app.use(express.json());

// Função para obter o último log
function getLastLogs(count = 100) {
  try {
    const logsDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logsDir)) {
      return [];
    }
    
    // Encontrar o arquivo de log mais recente
    const logFiles = fs.readdirSync(logsDir)
      .filter(file => file.startsWith('tiktok-') && file.endsWith('.log'))
      .sort()
      .reverse();
    
    if (logFiles.length === 0) {
      return [];
    }
    
    const latestLogFile = path.join(logsDir, logFiles[0]);
    const content = fs.readFileSync(latestLogFile, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    
    // Retornar as últimas N linhas
    return lines.slice(-count);
  } catch (error) {
    console.error('Erro ao obter logs:', error);
    return [];
  }
}

// Rota principal
app.post('/tiktok/action', async (req, res) => {
  try {
    const cookieData = req.body;
    
    // Validações
    if (!cookieData.sessionId && !cookieData.session_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Session ID é obrigatório (use sessionId ou session_id)' 
      });
    }
    
    // Registrar início da execução com ID
    const requestId = Date.now().toString();
    console.log(`[${requestId}] Iniciando execução com cookies: ${Object.keys(cookieData).join(', ')}`);
    
    // Executar ações no TikTok
    const result = await performTikTokActions(cookieData);
    
    // Adicionar ID da requisição e últimos logs
    result.requestId = requestId;
    result.lastLogs = getLastLogs(50);
    
    // Remover conteúdo HTML completo das respostas para economia de banda
    if (result.debugData && result.debugData.pageContent) {
      // Manter apenas os primeiros 1000 caracteres do HTML
      const contentPreview = result.debugData.pageContent.substring(0, 1000) + '... [truncado]';
      result.debugData.pageContentPreview = contentPreview;
      delete result.debugData.pageContent;
    }
    
    return res.json(result);
  } catch (error) {
    console.error('Erro na execução:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Erro ao executar ações no TikTok',
      error: error.message,
      stack: error.stack,
      lastLogs: getLastLogs(50)
    });
  }
});

// Rota de status
app.get('/status', (req, res) => {
  res.json({ 
    status: 'online',
    lastLogs: getLastLogs(20)
  });
});

// Rota para ver logs
app.get('/logs', (req, res) => {
  const count = parseInt(req.query.count || '100');
  res.json({
    logs: getLastLogs(count)
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
}); 
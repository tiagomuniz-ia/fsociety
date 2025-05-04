const express = require('express');
const { performTikTokActions } = require('./tiktok');
const { PORT } = require('./config');

// Inicializar app
const app = express();
app.use(express.json());

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
    
    // Executar ações no TikTok
    const result = await performTikTokActions(cookieData);
    
    return res.json(result);
  } catch (error) {
    console.error('Erro na execução:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Erro ao executar ações no TikTok',
      error: error.message
    });
  }
});

// Rota de status
app.get('/status', (req, res) => {
  res.json({ status: 'online' });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
}); 
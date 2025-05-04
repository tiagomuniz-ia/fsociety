# TikTok Bot API

Uma API simples para automatizar ações no TikTok usando Playwright e cookies de sessão com navegação stealth.

## Funcionalidades

- Login automatizado usando cookies do TikTok
- Navegação stealth para evitar detecção de bot e captchas
- Verificação do status de login
- Curtir o primeiro vídeo na página "For You"

## Pré-requisitos

- Node.js 14+ instalado
- npm ou yarn

## Instalação

1. Clone o repositório:
```bash
git clone https://github.com/seu-usuario/tktkbot.git
cd tktkbot
```

2. Instale as dependências:
```bash
npm install
```

3. Instale os navegadores necessários para o Playwright:
```bash
npx playwright install chromium
```

4. Configure o arquivo .env:
```bash
PORT=3000
HEADLESS=true
```

## Uso

1. Inicie o servidor:
```bash
npm start
```

2. Faça uma requisição para a API:
```bash
curl -X POST http://localhost:3000/tiktok/action \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "seu_session_id_aqui",
    "tt_csrf_token": "valor_do_token",
    "tt_chain_token": "valor_do_token",
    "msToken": "valor_do_token",
    "sid_guard": "valor_do_token",
    "sid_tt": "valor_do_token",
    "uid_tt": "valor_do_token"
  }'
```

## API Endpoints

### POST /tiktok/action
Executa ações no TikTok usando os cookies fornecidos.

**Parâmetros:**
- `session_id` ou `sessionId` (obrigatório): O valor do cookie de sessão do TikTok
- Cookies opcionais para melhorar a autenticação:
  - `tt_csrf_token`
  - `tt_chain_token`
  - `msToken`
  - `sid_guard`
  - `sid_tt`
  - `uid_tt`

**Comportamento:**
1. Injeta os cookies fornecidos
2. Navega para a página principal do TikTok
3. Verifica se o login foi bem-sucedido
4. Acessa a página "For You"
5. Curte o primeiro vídeo que aparece
6. Mantém o navegador aberto por um minuto para debug

**Resposta:**
```json
{
  "success": true,
  "loggedIn": true,
  "actions": {
    "like": {
      "success": true,
      "message": "Vídeo curtido com sucesso"
    }
  }
}
```

### GET /status
Verifica o status da API.

**Resposta:**
```json
{
  "status": "online"
}
```

## Execução no Servidor (Hetzner + EasyPanel)

1. Faça o deploy do código para seu servidor
2. Configure o projeto no EasyPanel
3. Defina as variáveis de ambiente necessárias
4. Certifique-se de instalar as dependências do Playwright no servidor 
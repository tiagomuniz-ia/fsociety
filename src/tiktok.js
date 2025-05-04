const { chromium } = require('playwright');
const { HEADLESS } = require('./config');
const fs = require('fs');
const path = require('path');

// Garantir que a pasta de logs exista
const LOGS_DIR = path.join(__dirname, '../logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Função para escrever logs para arquivo
function writeLog(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;
  
  // Logs no console
  console.log(logMessage);
  
  // Salvar em arquivo
  const logFile = path.join(LOGS_DIR, `tiktok-${new Date().toISOString().split('T')[0]}.log`);
  fs.appendFileSync(logFile, logMessage);
  
  // Se for erro, salvar no arquivo de erros
  if (type === 'error') {
    const errorLogFile = path.join(LOGS_DIR, 'errors.log');
    fs.appendFileSync(errorLogFile, logMessage);
  }
}

/**
 * Executa ações no TikTok após injetar os cookies
 * @param {string} cookieData - Objeto com cookies do TikTok
 * @returns {Promise<object>} Resultado das ações
 */
async function performTikTokActions(cookieData) {
  let browser = null;
  let debugData = {
    pageContent: null,
    pageUrl: null,
    cookiesInjected: [],
    elements: {
      videos: 0,
      buttons: 0,
      likeBtnFound: false
    },
    captchaDetected: false,
    errors: []
  };
  
  try {
    writeLog('Iniciando navegador com configuração para Linux/Server...');
    
    // Configurações otimizadas para servidores Linux
    browser = await chromium.launch({ 
      headless: HEADLESS,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1366,768',
        '--hide-scrollbars',
        '--mute-audio',
        '--disable-infobars'
      ]
    });
    
    // Configuração do contexto com configurações mais padronizadas
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      deviceScaleFactor: 1,
      isMobile: false,
      acceptDownloads: true,
      bypassCSP: true
    });
    
    // Script para evadir detecção
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      delete navigator.__proto__.webdriver;
      
      // Prevenir detecção de headless
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' 
          ? Promise.resolve({ state: Notification.permission }) 
          : originalQuery(parameters)
      );
    });
    
    const page = await context.newPage();
    
    // Interceptar requests para detectar problemas
    await page.route('**/*', async (route, request) => {
      const url = request.url();
      
      // Verificar por URLs de verificação/captcha
      if (url.includes('captcha') || 
          url.includes('verify') || 
          url.includes('security') || 
          url.includes('check')) {
        debugData.captchaDetected = true;
        writeLog(`Possível captcha/verificação detectado em: ${url}`, 'warn');
      }
      
      // Continuar com a requisição
      await route.continue();
    });
    
    // Configurar cookies
    writeLog('Injetando cookies...');
    
    // Extrair session_id e outros cookies
    const sessionId = cookieData.sessionId || cookieData.session_id;
    
    if (!sessionId) {
      throw new Error('Session ID é obrigatório');
    }
    
    // Array para armazenar todos os cookies que vamos adicionar
    const cookiesToAdd = [];
    
    // Adicionar sessionid (obrigatório)
    cookiesToAdd.push({
      name: 'sessionid',
      value: sessionId,
      domain: '.tiktok.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None'
    });
    
    // Mapeamento de nomes de cookies que podem ser fornecidos
    const cookieMapping = {
      'tt_csrf_token': { httpOnly: false, secure: true },
      'tt_chain_token': { httpOnly: false, secure: true },
      'msToken': { httpOnly: false, secure: true },
      'sid_guard': { httpOnly: true, secure: true },
      'sid_tt': { httpOnly: true, secure: true },
      'uid_tt': { httpOnly: true, secure: true }
    };
    
    // Adicionar cookies adicionais se fornecidos
    for (const [cookieName, cookieOptions] of Object.entries(cookieMapping)) {
      if (cookieData[cookieName]) {
        cookiesToAdd.push({
          name: cookieName,
          value: cookieData[cookieName],
          domain: '.tiktok.com',
          path: '/',
          ...cookieOptions
        });
      }
    }
    
    // Configurar todos os cookies
    await page.context().addCookies(cookiesToAdd);
    debugData.cookiesInjected = cookiesToAdd.map(c => c.name);
    writeLog(`Cookies injetados: ${debugData.cookiesInjected.join(', ')}`);
    
    // Tentar acessar TikTok 
    writeLog('Acessando TikTok...');
    try {
      await page.goto('https://www.tiktok.com/', { 
        waitUntil: 'domcontentloaded', 
        timeout: 60000 
      });
    } catch (e) {
      writeLog(`Erro ao acessar TikTok: ${e.message}`, 'error');
      debugData.errors.push(`Falha ao acessar TikTok: ${e.message}`);
    }
    
    // Verificar se há captcha após carregamento inicial
    const isCaptchaPresent = await checkForCaptcha(page);
    if (isCaptchaPresent) {
      debugData.captchaDetected = true;
      writeLog('Captcha detectado na página inicial!', 'error');
      // Salvar conteúdo HTML para debug
      debugData.pageContent = await page.content();
      return { 
        success: false, 
        captchaDetected: true, 
        message: 'Captcha detectado na página. Tente novamente mais tarde ou use outro IP.',
        debugData
      };
    }
    
    // Salvar estado atual da navegação
    debugData.pageUrl = page.url();
    
    // Navegar para For You
    writeLog('Navegando para a página For You...');
    try {
      await page.goto('https://www.tiktok.com/foryou', { 
        waitUntil: 'domcontentloaded', 
        timeout: 60000 
      });
    } catch (e) {
      writeLog(`Erro ao navegar para For You: ${e.message}`, 'error');
      debugData.errors.push(`Falha ao acessar For You: ${e.message}`);
    }
    
    // Verificar novamente por captcha
    if (await checkForCaptcha(page)) {
      debugData.captchaDetected = true;
      writeLog('Captcha detectado na página For You!', 'error');
      debugData.pageContent = await page.content();
      return { 
        success: false, 
        captchaDetected: true,
        message: 'Captcha detectado. Tente novamente mais tarde ou use outro IP.',
        debugData
      };
    }
    
    // Coletar informações sobre os elementos na página
    debugData.elements = await collectPageElementsInfo(page);
    
    // Verificar se está logado
    const loginResult = await checkLoggedInStatus(page);
    debugData.isLoggedIn = loginResult.isLoggedIn;
    debugData.loginCheckMethod = loginResult.method;
    
    if (!loginResult.isLoggedIn) {
      writeLog('Falha ao fazer login com os cookies fornecidos', 'error');
      debugData.pageContent = await page.content();
      debugData.pageUrl = page.url();
      return { 
        success: false, 
        message: 'Não foi possível fazer login com os cookies fornecidos',
        loginCheckMethod: loginResult.method,
        debugData
      };
    }
    
    writeLog('Login bem-sucedido pelo método: ' + loginResult.method);
    
    // Tentar garantir que a interface seja carregada corretamente
    writeLog('Aguardando carregamento completo dos vídeos...');
    try {
      // Tentar rolar a página para carregar mais conteúdo
      await page.evaluate(() => {
        window.scrollBy(0, 300);
        setTimeout(() => window.scrollBy(0, -100), 1000);
      });
      
      // Avaliar o conteúdo da página
      debugData.elements = await collectPageElementsInfo(page);
      writeLog(`Elementos na página: ${JSON.stringify(debugData.elements)}`);
      
      if (debugData.elements.videos === 0) {
        writeLog('Nenhum vídeo encontrado. Tentando recarregar...', 'warn');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);
        
        // Coletar novamente as informações da página
        debugData.elements = await collectPageElementsInfo(page);
        writeLog(`Após recarregar: ${JSON.stringify(debugData.elements)}`);
      }
    } catch (e) {
      writeLog('Erro ao tentar garantir carregamento: ' + e.message, 'error');
      debugData.errors.push(`Falha ao carregar feed: ${e.message}`);
    }
    
    // Se chegamos até aqui e não detectamos vídeos, pode ser um problema
    if (debugData.elements.videos === 0) {
      writeLog('Interface carregada sem vídeos, possível erro de versão do browser', 'error');
      debugData.pageContent = await page.content();
      // Coletamos um fragmento do HTML para diagnóstico
      const htmlFragment = await page.evaluate(() => {
        return document.body.innerHTML.substring(0, 5000); // Primeiros 5000 caracteres
      });
      debugData.htmlFragment = htmlFragment;
      
      return {
        success: false,
        message: 'Interface carregada com sucesso, mas nenhum vídeo encontrado',
        loggedIn: true,
        debugData
      };
    }
    
    // Curtir o primeiro vídeo da página For You
    writeLog('Tentando curtir o primeiro vídeo...');
    const likeResult = await likeFirstVideo(page);
    debugData.likeResult = likeResult;
    
    // Coletar informações finais da página
    debugData.finalUrl = page.url();
    
    return {
      success: likeResult.success,
      loggedIn: true,
      actions: {
        like: likeResult
      },
      debugData: debugData
    };
    
  } catch (error) {
    writeLog('Erro durante a execução do Playwright: ' + error.message, 'error');
    return {
      success: false,
      error: error.message,
      debugData
    };
  } finally {
    if (browser) {
      await browser.close();
      writeLog('Navegador fechado');
    }
  }
}

/**
 * Verifica se há captcha na página
 * @param {Page} page - Instância da página do Playwright
 * @returns {Promise<boolean>} Verdadeiro se captcha for detectado
 */
async function checkForCaptcha(page) {
  try {
    // Verificar por textos indicando captcha/verificação
    const pageContent = await page.content();
    const captchaIndicators = [
      'captcha',
      'verify human',
      'security check',
      'human verification',
      'verificação',
      'bot check',
      'suspicious activity',
      'slide to verify',
      'deslize para verificar',
      'verificação de segurança',
      'verificação humana'
    ];
    
    for (const indicator of captchaIndicators) {
      if (pageContent.toLowerCase().includes(indicator.toLowerCase())) {
        writeLog(`Captcha detectado: contém texto "${indicator}"`, 'warn');
        return true;
      }
    }
    
    // Verificar por elementos típicos de captcha
    const captchaSelectors = [
      '.captcha-container',
      '.captcha',
      '.verification',
      '.security-check',
      '[data-e2e="challenge-stage"]',
      '.tiktok-captcha',
      '.verify-container',
      'canvas.captcha',
      'iframe[src*="captcha"]',
      'iframe[src*="verify"]',
      '.captcha-img'
    ];
    
    for (const selector of captchaSelectors) {
      const captchaElement = await page.$(selector);
      if (captchaElement) {
        writeLog(`Captcha detectado: elemento "${selector}" encontrado`, 'warn');
        return true;
      }
    }
    
    return false;
  } catch (error) {
    writeLog('Erro ao verificar captcha: ' + error.message, 'error');
    return false;
  }
}

/**
 * Coleta informações sobre elementos na página
 * @param {Page} page - Instância da página do Playwright
 * @returns {Promise<Object>} Informações sobre os elementos
 */
async function collectPageElementsInfo(page) {
  try {
    return await page.evaluate(() => {
      return {
        videos: document.querySelectorAll('video').length,
        buttons: document.querySelectorAll('button').length,
        articles: document.querySelectorAll('article').length,
        divs: document.querySelectorAll('div').length,
        section: document.querySelectorAll('section').length,
        mainContent: !!document.querySelector('#main-content-others_homepage'),
        columnList: !!document.querySelector('#column-list-container'),
        possibleFeedElements: document.querySelectorAll('[class*="feed"], [class*="video"], [class*="content"]').length
      };
    });
  } catch (error) {
    writeLog('Erro ao coletar informações dos elementos: ' + error.message, 'error');
    return {
      error: error.message,
      videos: 0,
      buttons: 0
    };
  }
}

/**
 * Curte o primeiro vídeo na página For You
 * @param {Page} page - Instância da página do Playwright
 * @returns {Promise<object>} Resultado da ação de curtir
 */
async function likeFirstVideo(page) {
  try {
    writeLog('Procurando primeiro vídeo no feed...');
    
    // Verificar se há vídeos carregados
    const videosCount = await page.evaluate(() => {
      return document.querySelectorAll('video').length;
    });
    
    writeLog(`Encontrados ${videosCount} vídeos na página`);
    
    // Estratégia para tentar encontrar o primeiro vídeo
    let firstVideo = null;
    const strategies = [
      // Estratégia 1: Seletores específicos para elementos de vídeo
      async () => {
        const videoSelectors = [
          '#column-list-container > article:first-child',
          'div[data-e2e="recommend-list-item-container"]',
          '[data-e2e="recommend-list-item"]',
          'div.video-feed-item',
          'div[data-e2e="feed-item"]',
          '.video-card-container',
          '.tiktok-feed-item',
          'div.tiktok-x6f6za-DivContainer',
          'div[data-e2e="feed-video"]'
        ];
        
        for (const selector of videoSelectors) {
          const videos = await page.$$(selector);
          if (videos.length > 0) {
            writeLog(`Vídeo encontrado com seletor: ${selector}`);
            return videos[0];
          }
        }
        return null;
      },
      
      // Estratégia 2: Encontrar pelo elemento vídeo diretamente e subir para o container
      async () => {
        const videos = await page.$$('video');
        if (videos.length > 0) {
          writeLog('Vídeo encontrado pelo elemento video');
          // Encontrar o elemento pai para interagir
          return await videos[0].evaluateHandle(el => 
            el.closest('div[class*="video"]') || 
            el.closest('article') || 
            el.parentElement
          );
        }
        return null;
      },
      
      // Estratégia 3: Clicar diretamente no feed ou no primeiro item visível
      async () => {
        // Tentar encontrar o feed e clicar no centro
        const feed = await page.$('#column-list-container, #main-content-others_homepage, [class*="feed-container"]');
        if (feed) {
          writeLog('Feed encontrado, tentando clicar direto');
          return feed;
        }
        return null;
      }
    ];
    
    // Tentar cada estratégia em ordem
    for (const strategy of strategies) {
      firstVideo = await strategy();
      if (firstVideo) break;
    }
    
    if (!firstVideo) {
      writeLog('Nenhum vídeo encontrado na página For You', 'error');
      return { success: false, message: 'Nenhum vídeo encontrado' };
    }
    
    // Interagir com o vídeo
    writeLog('Clicando no primeiro vídeo...');
    await firstVideo.click();
    await page.waitForTimeout(3000);
    
    // Agora precisamos encontrar e clicar no botão de like
    return await likeCurrentVideo(page);
  } catch (error) {
    writeLog('Erro ao curtir primeiro vídeo: ' + error.message, 'error');
    return { success: false, error: error.message };
  }
}

/**
 * Curte o vídeo atualmente em exibição
 * @param {Page} page - Instância da página do Playwright
 * @returns {Promise<object>} Resultado da ação de curtir
 */
async function likeCurrentVideo(page) {
  try {
    writeLog('Procurando botão de like para o vídeo atual...');
    
    // Estratégias para encontrar o botão de like
    let likeButton = null;
    const strategies = [
      // Estratégia 1: Seletor específico reportado pelo usuário
      async () => {
        const specificSelectors = [
          '#column-list-container > article:nth-child(1) > div > section.css-16g1ej4-SectionActionBarContainer.ees02z00 > button:nth-child(2)',
          'article:nth-child(1) > div > section > button:nth-child(2)',
          'article:first-child > div > section > button:nth-child(2)',
          'article > div > section > button:nth-child(2)',
          'section.css-16g1ej4-SectionActionBarContainer > button:nth-child(2)',
          '.css-16g1ej4-SectionActionBarContainer > button:nth-child(2)',
          '#column-list-container button:nth-child(2)',
          'section button:nth-child(2)',
          '[class*="action"] > button:nth-child(2)'
        ];
        
        for (const selector of specificSelectors) {
          const button = await page.$(selector);
          if (button) {
            writeLog(`Botão de like encontrado com seletor específico: ${selector}`);
            return button;
          }
        }
        return null;
      },
      
      // Estratégia 2: Usar atributos data-e2e
      async () => {
        const e2eSelectors = [
          '[data-e2e="like-icon"]',
          'span[data-e2e="like-icon"]',
          '[data-e2e="feed-action-like"]',
          '[data-e2e="video-like-btn"]',
          'button[data-e2e="like-button"]'
        ];
        
        for (const selector of e2eSelectors) {
          const button = await page.$(selector);
          if (button) {
            writeLog(`Botão de like encontrado com atributo data-e2e: ${selector}`);
            return button;
          }
        }
        return null;
      },
      
      // Estratégia 3: Buscar por texto ou aria-label
      async () => {
        // Avaliar na página buscando por textos ou aria-labels
        const button = await page.evaluateHandle(() => {
          // Buscar por aria-label
          const ariaButtons = Array.from(document.querySelectorAll('button[aria-label="Like"], button[aria-label="Curtir"]'));
          if (ariaButtons.length > 0) return ariaButtons[0];
          
          // Buscar por botões com texto
          const allButtons = Array.from(document.querySelectorAll('button'));
          const likeButton = allButtons.find(btn => {
            const text = btn.textContent.toLowerCase();
            return text.includes('like') || text.includes('curtir');
          });
          if (likeButton) return likeButton;
          
          // Buscar pelo segundo botão em seções de ação (geralmente é o like)
          const actionSections = Array.from(document.querySelectorAll('section, div[class*="action"]'));
          for (const section of actionSections) {
            const buttons = Array.from(section.querySelectorAll('button'));
            if (buttons.length >= 2) return buttons[1]; // Geralmente o segundo botão é o like
          }
          
          return null;
        });
        
        // Verificar se encontrou algo
        const isNull = await page.evaluate(btn => btn === null, button);
        if (!isNull) {
          writeLog('Botão de like encontrado por texto ou aria-label');
          return button;
        }
        return null;
      },
      
      // Estratégia 4: Abordagem direta via JavaScript para clicar no seletor
      async () => {
        // Tentar clicar diretamente via JavaScript
        const clicked = await page.evaluate(() => {
          try {
            // Seletor específico
            const specificSelector = '#column-list-container > article:nth-child(1) > div > section.css-16g1ej4-SectionActionBarContainer.ees02z00 > button:nth-child(2)';
            const btn = document.querySelector(specificSelector);
            if (btn) {
              btn.click();
              return true;
            }
            
            // Tentar outros seletores
            const secondButtons = document.querySelectorAll('section button:nth-child(2)');
            if (secondButtons.length > 0) {
              secondButtons[0].click();
              return true;
            }
            
            return false;
          } catch (e) {
            console.error("Erro ao tentar clicar via JS:", e);
            return false;
          }
        });
        
        if (clicked) {
          writeLog('Clique realizado diretamente via JavaScript');
          return { dummyClick: true };
        }
        return null;
      }
    ];
    
    // Tentar cada estratégia em ordem
    for (const strategy of strategies) {
      likeButton = await strategy();
      if (likeButton) break;
    }
    
    // Se encontramos o botão (exceto para a estratégia de clique direto), clicar nele
    if (likeButton && !likeButton.dummyClick) {
      writeLog('Clicando no botão de like...');
      await likeButton.click();
      await page.waitForTimeout(3000);
      writeLog('Clique realizado com sucesso!');
      return { success: true, message: 'Tentativa de curtir realizada com sucesso' };
    } else if (likeButton && likeButton.dummyClick) {
      // Se foi a estratégia de clique direto que funcionou
      return { success: true, message: 'Tentativa de curtir realizada via JavaScript' };
    }
    
    // Se chegamos aqui, todas as estratégias falharam
    writeLog('Todas as estratégias para encontrar o botão de like falharam', 'error');
    
    // Última tentativa - clicar em posição fixa na tela
    writeLog('Tentando clicar no local típico do botão de like...');
    
    try {
      const viewportSize = page.viewportSize();
      if (viewportSize) {
        const { width, height } = viewportSize;
        
        // Em telas desktop, o like geralmente fica à direita
        if (width > height) {
          await page.mouse.click(width - 80, height / 2);
        } else {
          // Em mobile, o like geralmente fica embaixo
          await page.mouse.click(width / 3, height - 100);
        }
        
        writeLog('Clique em posição fixa realizado');
        return { 
          success: true, 
          message: 'Tentativa de clique em posição fixa realizada' 
        };
      }
    } catch (e) {
      writeLog('Erro ao tentar clique em posição fixa: ' + e.message, 'error');
    }
    
    return { success: false, message: 'Botão de like não encontrado' };
  } catch (error) {
    writeLog('Erro ao curtir vídeo: ' + error.message, 'error');
    return { success: false, error: error.message };
  }
}

/**
 * Verifica se o usuário está logado
 * @param {Page} page - Instância da página do Playwright
 * @returns {Promise<{isLoggedIn: boolean, method: string}>} Status do login e método usado para verificação
 */
async function checkLoggedInStatus(page) {
  try {
    writeLog('Verificando status de login...');
    
    // Método 1: Verificar por elementos de perfil visíveis
    const profileSelectors = [
      '[data-e2e="profile-icon"]',
      'div[data-e2e="user-info"]',
      'div[data-e2e="user-page"]',
      'a[data-e2e="user-avatar"]',
      'a[href="/upload"]',
      '.avatar-wrapper',
      'img.user-avatar',
      'a[data-e2e="profile-link"]',
      'button[data-e2e="profile-link"]'
    ];
    
    for (const selector of profileSelectors) {
      const element = await page.$(selector);
      if (element) {
        writeLog(`Login detectado com seletor: ${selector}`);
        return { isLoggedIn: true, method: `element:${selector}` };
      }
    }
    
    // Método 2: Verificar se botão de login NÃO está presente
    const loginButtons = [
      'button[data-e2e="top-login-button"]',
      'a[href="/login"]',
      'div.login-button',
      'button[data-e2e="login-button"]'
    ];
    
    let loginButtonFound = false;
    for (const btnSelector of loginButtons) {
      const btn = await page.$(btnSelector);
      if (btn) {
        loginButtonFound = true;
        break;
      }
    }
    
    if (!loginButtonFound) {
      writeLog('Login detectado pela ausência de botões de login');
      return { isLoggedIn: true, method: 'no-login-buttons' };
    }
    
    // Método 3: Verificar URL e conteúdo da página
    const url = page.url();
    if (url.includes('/profile/') || url.includes('/@')) {
      writeLog('Login detectado pela URL do perfil');
      return { isLoggedIn: true, method: 'profile-url' };
    }
    
    // Método 4: Verificar por texto que indica que o usuário está logado
    const loggedInByContent = await page.evaluate(() => {
      // Verificar no HTML/scripts
      const htmlContent = document.documentElement.innerHTML;
      if (htmlContent.includes('"isLogin":true') || 
          htmlContent.includes('"isLoggedIn":true') ||
          htmlContent.includes('"authenticated":true')) {
        return true;
      }
      
      // Verificar em objetos globais
      try {
        // Alguns sites armazenam estado de autenticação em objetos globais
        const globals = [
          'window.__INITIAL_STATE__',
          'window.LOGGED_IN',
          'window.appContext',
          'window.__USER_DATA__'
        ];
        
        for (const global of globals) {
          try {
            const result = eval(global);
            if (result && typeof result === 'object') {
              const jsonStr = JSON.stringify(result);
              if (jsonStr.includes('loggedIn') || 
                  jsonStr.includes('isLogin') || 
                  jsonStr.includes('authenticated')) {
                return true;
              }
            }
          } catch (e) {
            // Ignorar erros
          }
        }
      } catch (e) {}
      
      return false;
    });
    
    if (loggedInByContent) {
      writeLog('Login detectado pelo conteúdo da página');
      return { isLoggedIn: true, method: 'page-content' };
    }
    
    // Método 5: Verificar elementos relacionados a usuários logados
    const loggedInByElements = await page.evaluate(() => {
      // Verificar por elementos que geralmente aparecem para usuários logados
      const userElements = document.querySelectorAll('[data-e2e*="profile"], [data-e2e*="user"], .user-info, .profile');
      return userElements.length > 0;
    });
    
    if (loggedInByElements) {
      writeLog('Login detectado por elementos relacionados ao usuário');
      return { isLoggedIn: true, method: 'user-elements' };
    }
    
    writeLog('Nenhum indicador de login encontrado', 'warn');
    return { isLoggedIn: false, method: 'no-indicators' };
  } catch (error) {
    writeLog('Erro ao verificar status de login: ' + error.message, 'error');
    return { isLoggedIn: false, method: 'error:' + error.message };
  }
}

module.exports = {
  performTikTokActions
}; 
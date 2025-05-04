const { chromium } = require('playwright');
const { HEADLESS } = require('./config');

/**
 * Executa ações no TikTok após injetar os cookies
 * @param {string} cookieData - Objeto com cookies do TikTok
 * @returns {Promise<object>} Resultado das ações
 */
async function performTikTokActions(cookieData) {
  let browser = null;
  
  try {
    console.log('Iniciando navegador com configuração balanceada...');
    
    // Configurações menos agressivas para navegação
    browser = await chromium.launch({ 
      headless: HEADLESS,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-size=1366,768',
        '--disable-extensions',
        '--disable-dev-shm-usage'
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
      acceptDownloads: true
    });
    
    // Script simplificado para ocultar automação
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false
      });
      delete navigator.__proto__.webdriver;
    });
    
    const page = await context.newPage();
    
    // Configurar cookies
    console.log('Injetando cookies...');
    
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
    
    // Tentar acessar TikTok diretamente pela página For You
    console.log('Acessando TikTok...');
    await page.goto('https://www.tiktok.com/', { 
      waitUntil: 'domcontentloaded', 
      timeout: 60000 
    });
    
    // Aguardar carregamento inicial
    await page.waitForTimeout(8000);
    
    // Tirar screenshot da página inicial
    await page.screenshot({ path: 'tiktok-inicial.png', fullPage: true });
    
    // Navegar para For You
    console.log('Navegando para a página For You...');
    await page.goto('https://www.tiktok.com/foryou', { 
      waitUntil: 'domcontentloaded', 
      timeout: 60000 
    });
    
    // Aguardar mais tempo para garantir carregamento completo
    await page.waitForTimeout(10000);
    
    // Tirar screenshot da página For You
    await page.screenshot({ path: 'foryou-carregado.png', fullPage: true });
    
    // Verificar se está logado
    const isLoggedIn = await checkLoggedInStatus(page);
    if (!isLoggedIn) {
      console.log('Falha ao fazer login com os cookies fornecidos');
      await page.screenshot({ path: 'login-falhou.png', fullPage: true });
      console.log('Screenshot salvo como login-falhou.png');
      return { 
        success: false, 
        message: 'Não foi possível fazer login com os cookies fornecidos'
      };
    }
    
    console.log('Login bem-sucedido!');
    await page.screenshot({ path: 'login-sucesso.png', fullPage: true });
    
    // Tentar garantir que a interface seja carregada corretamente
    console.log('Aguardando carregamento completo dos vídeos...');
    try {
      // Tentar rolar a página para carregar mais conteúdo
      await page.evaluate(() => {
        window.scrollBy(0, 300);
        setTimeout(() => window.scrollBy(0, -100), 1000);
      });
      
      await page.waitForTimeout(5000);
      
      // Recarregar a página se necessário para garantir carregamento correto
      const hasContent = await page.evaluate(() => {
        return document.querySelectorAll('video').length > 0;
      });
      
      if (!hasContent) {
        console.log('Recarregando página para tentar carregar vídeos...');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(8000);
        await page.screenshot({ path: 'pagina-recarregada.png', fullPage: true });
      }
    } catch (e) {
      console.log('Erro ao tentar garantir carregamento:', e.message);
    }
    
    // Curtir o primeiro vídeo da página For You
    const likeResult = await likeFirstVideo(page);
    
    // Manter navegador aberto por um tempo para debug
    console.log('Mantendo navegador aberto para debug...');
    await page.waitForTimeout(60000); // 1 minuto
    
    return {
      success: true,
      loggedIn: true,
      actions: {
        like: likeResult
      }
    };
    
  } catch (error) {
    console.error('Erro durante a execução do Playwright:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    if (browser) {
      await browser.close();
      console.log('Navegador fechado');
    }
  }
}

/**
 * Curte o primeiro vídeo na página For You
 * @param {Page} page - Instância da página do Playwright
 * @returns {Promise<object>} Resultado da ação de curtir
 */
async function likeFirstVideo(page) {
  try {
    console.log('Procurando primeiro vídeo no feed...');
    
    // Tirar screenshot antes
    await page.screenshot({ path: 'feed-inicial.png', fullPage: true });
    
    // Verificar se há vídeos carregados
    const videosCount = await page.evaluate(() => {
      return document.querySelectorAll('video').length;
    });
    
    console.log(`Encontrados ${videosCount} vídeos na página`);
    
    if (videosCount === 0) {
      // Tentar localizar elementos de container de vídeo mesmo sem vídeos
      console.log('Tentando localizar containers de vídeo...');
    }
    
    // Seletores possíveis para elementos de vídeo no feed (atualizados)
    const videoSelectors = [
      // Seletores gerais de vídeos/feed
      'div[data-e2e="recommend-list-item-container"]',
      '[data-e2e="recommend-list-item"]',
      'div.video-feed-item',
      'div[data-e2e="feed-item"]',
      '.video-card-container',
      '.tiktok-feed-item',
      // Seletores mais específicos
      'div.tiktok-x6f6za-DivContainer',
      'div[data-e2e="feed-video"]'
    ];
    
    // Encontrar o primeiro vídeo
    let firstVideo = null;
    for (const selector of videoSelectors) {
      const videos = await page.$$(selector);
      if (videos.length > 0) {
        firstVideo = videos[0];
        console.log(`Primeiro vídeo encontrado com seletor: ${selector}`);
        
        // Tirar screenshot do primeiro vídeo encontrado
        await firstVideo.screenshot({ path: 'primeiro-video.png' });
        break;
      }
    }
    
    // Se não encontrou pelos seletores padrão, tente pelo vídeo diretamente
    if (!firstVideo) {
      const videos = await page.$$('video');
      if (videos.length > 0) {
        // Encontrar o elemento pai para interagir
        firstVideo = await videos[0].evaluateHandle(el => el.closest('div[class*="video"]') || el.parentElement);
        console.log('Primeiro vídeo encontrado pelo elemento video');
      }
    }
    
    if (!firstVideo) {
      console.log('Nenhum vídeo encontrado na página For You');
      await page.screenshot({ path: 'nenhum-video-encontrado.png', fullPage: true });
      
      // Tentar abrir o modo desktop se estivermos em interface mobile
      const mobileToDesktopSwitch = await page.$('button[data-e2e="switch-to-desktop"]');
      if (mobileToDesktopSwitch) {
        console.log('Detectada interface mobile. Tentando mudar para desktop...');
        await mobileToDesktopSwitch.click();
        await page.waitForTimeout(5000);
        return await likeFirstVideo(page); // Tentar novamente após a mudança
      }
      
      return { success: false, message: 'Nenhum vídeo encontrado' };
    }
    
    // Interagir com o vídeo
    console.log('Clicando no primeiro vídeo...');
    await firstVideo.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'apos-clicar-video.png', fullPage: true });
    
    // Agora precisamos encontrar e clicar no botão de like
    return await likeCurrentVideo(page);
  } catch (error) {
    console.error('Erro ao curtir primeiro vídeo:', error);
    await page.screenshot({ path: 'erro-curtir-primeiro.png', fullPage: true });
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
    console.log('Procurando botão de like para o vídeo atual...');
    
    // Tirar screenshot da tela atual
    await page.screenshot({ path: 'antes-curtir-atual.png', fullPage: true });
    
    // Botão de like pode ter diferentes seletores, tentaremos vários
    const likeButtonSelectors = [
      // Seletor específico reportado pelo usuário - ALTA PRIORIDADE
      '#column-list-container > article:nth-child(1) > div > section.css-16g1ej4-SectionActionBarContainer.ees02z00 > button:nth-child(2)',
      
      // Variações do seletor específico reportado
      'article:nth-child(1) > div > section > button:nth-child(2)',
      'article:first-child > div > section > button:nth-child(2)',
      'article > div > section > button:nth-child(2)',
      'section.css-16g1ej4-SectionActionBarContainer > button:nth-child(2)',
      '.css-16g1ej4-SectionActionBarContainer > button:nth-child(2)',
      '#column-list-container button:nth-child(2)',
      
      // Seletores por atributo data-e2e
      '[data-e2e="like-icon"]',
      'span[data-e2e="like-icon"]',
      '[data-e2e="feed-action-like"]',
      'button[data-e2e="like-button"]',
      
      // Seletores por aria-label
      'button[aria-label="Like"]',
      'button[aria-label="Curtir"]',
      
      // Seletores por classes (podem mudar com frequência)
      '.like-button',
      '.video-like-btn',
      '.tt-like-button',
      
      // Seletores por XPath
      '//button[contains(@class, "like")]',
      '//span[contains(@class, "like")]/parent::button',
      '//div[contains(@class, "like-container")]',
      '//div[contains(@class, "action-item")]//span[contains(text(), "Like")]/..',
      '//div[contains(@class, "action-item")]//span[contains(text(), "Curtir")]/..'
    ];
    
    // Tentar encontrar o botão de like
    let likeButton = null;
    
    // Tentar cada seletor
    for (const selector of likeButtonSelectors) {
      if (selector.startsWith('//')) {
        // É um XPath
        const elements = await page.$x(selector);
        if (elements.length > 0) {
          likeButton = elements[0];
          console.log(`Botão de like encontrado com XPath: ${selector}`);
          break;
        }
      } else {
        // É um seletor CSS
        const button = await page.$(selector);
        if (button) {
          likeButton = button;
          console.log(`Botão de like encontrado com CSS: ${selector}`);
          break;
        }
      }
    }
    
    // Se ainda não encontramos, vamos tentar buscar pelo SVG ou ícone de like
    if (!likeButton) {
      console.log('Tentando localizar o ícone de like...');
      
      // Tentar encontrar pelo ícone do coração ou thumb up
      const iconSelectors = [
        'svg[fill="none"][viewBox="0 0 48 48"]',
        'svg.like-icon',
        'i.like-icon',
        'i[class*="like"]',
        'svg[class*="like"]'
      ];
      
      for (const selector of iconSelectors) {
        const icon = await page.$(selector);
        if (icon) {
          // Tentar encontrar o botão pai
          likeButton = await icon.evaluateHandle(el => {
            let current = el;
            // Subir até 3 níveis para encontrar um botão ou div clicável
            for (let i = 0; i < 3; i++) {
              if (!current || !current.parentElement) break;
              current = current.parentElement;
              if (current.tagName === 'BUTTON' || 
                  (current.tagName === 'DIV' && current.getAttribute('role') === 'button')) {
                return current;
              }
            }
            return current; // retorna o último elemento encontrado
          });
          
          console.log('Botão de like encontrado via ícone');
          
          // Tirar screenshot do botão encontrado
          await likeButton.screenshot({ path: 'botao-like-encontrado.png' }).catch(() => {});
          break;
        }
      }
    }
    
    // Se ainda não encontrou, tente outro método
    if (!likeButton) {
      // Tente localizar analisando a estrutura da página
      console.log('Tentando localizar botões de ação do vídeo...');
      
      // Localizar a área de ações do vídeo (geralmente à direita ou embaixo)
      const actionButtons = await page.$$('div[class*="action"] button');
      if (actionButtons.length > 0) {
        // Geralmente o primeiro botão é o like
        likeButton = actionButtons[0];
        console.log('Botão de like encontrado na área de ações');
      }
    }
    
    // Se não encontrou o botão, retornar falha
    if (!likeButton) {
      console.log('Botão de like não encontrado');
      
      // Tentar uma abordagem específica para o seletor informado
      console.log('Tentando abordagem direta com o seletor específico...');
      try {
        // Usar evaluate para clicar diretamente no elemento pelo seletor específico
        const clickResult = await page.evaluate(() => {
          const specificSelector = '#column-list-container > article:nth-child(1) > div > section.css-16g1ej4-SectionActionBarContainer.ees02z00 > button:nth-child(2)';
          const btn = document.querySelector(specificSelector);
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        });
        
        if (clickResult) {
          console.log('Clique realizado via evaluateHandle no seletor específico');
          await page.waitForTimeout(2000);
          await page.screenshot({ path: 'apos-clique-seletor-especifico.png', fullPage: true });
          return { 
            success: true, 
            message: 'Tentativa de clique no seletor específico realizada com sucesso' 
          };
        }
      } catch (e) {
        console.log('Erro ao tentar abordagem direta:', e.message);
      }
      
      // Tentar clicar em um ponto fixo onde geralmente está o botão de like
      console.log('Tentando clicar no local típico do botão de like...');
      
      // O botão de like geralmente está no canto direito em desktop ou embaixo em mobile
      try {
        // Obter dimensões da viewport
        const viewportSize = page.viewportSize();
        if (viewportSize) {
          const { width, height } = viewportSize;
          
          // Em telas desktop, o like geralmente está à direita
          if (width > height) {
            await page.mouse.click(width - 80, height / 2);
          } else {
            // Em telas mobile, o like geralmente está embaixo
            await page.mouse.click(width / 3, height - 100);
          }
          
          await page.waitForTimeout(2000);
          await page.screenshot({ path: 'apos-clique-posicao-fixa.png', fullPage: true });
          
          return { 
            success: true, 
            message: 'Tentativa de clique em posição fixa realizada' 
          };
        }
      } catch (e) {
        console.log('Erro ao tentar clique em posição fixa:', e.message);
      }
      
      await page.screenshot({ path: 'like-nao-encontrado.png', fullPage: true });
      return { success: false, message: 'Botão de like não encontrado' };
    }
    
    // Clicar no botão de like
    console.log('Clicando no botão de like...');
    await likeButton.click();
    
    // Aguardar para garantir que a ação foi processada
    await page.waitForTimeout(3000);
    
    // Tirar screenshot após o clique
    await page.screenshot({ path: 'apos-curtir.png', fullPage: true });
    
    return { success: true, message: 'Tentativa de curtir realizada com sucesso' };
  } catch (error) {
    console.error('Erro ao curtir vídeo:', error);
    await page.screenshot({ path: 'erro-curtir.png', fullPage: true });
    return { success: false, error: error.message };
  }
}

/**
 * Verifica se o usuário está logado
 * @param {Page} page - Instância da página do Playwright
 * @returns {Promise<boolean>} Status do login
 */
async function checkLoggedInStatus(page) {
  try {
    console.log('Verificando status de login...');
    
    // Esperar para página carregar completamente
    await page.waitForTimeout(5000);
    
    // Tirar screenshot para análise
    await page.screenshot({ path: 'verificacao-login.png', fullPage: true });
    
    // 1. Verificar por elementos de perfil
    const selectors = [
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
    
    // Verificar cada seletor
    for (const selector of selectors) {
      const element = await page.$(selector);
      if (element) {
        console.log(`Login detectado com seletor: ${selector}`);
        return true;
      }
    }
    
    // 2. Verificar se botão de login NÃO está presente
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
      console.log('Login detectado pela ausência de botões de login');
      return true;
    }
    
    // 3. Última tentativa - verificar URL pessoal ou conteúdo da página
    try {
      const url = page.url();
      if (url.includes('/profile/') || url.includes('/@')) {
        console.log('Login detectado pela URL do perfil');
        return true;
      }
      
      // Verificar por texto que indica que o usuário está logado
      const pageContent = await page.content();
      if (pageContent.includes('"isLogin":true') || 
          pageContent.includes('"isLoggedIn":true') ||
          pageContent.includes('"authenticated":true')) {
        console.log('Login detectado pelo conteúdo da página');
        return true;
      }
    } catch (e) {}
    
    console.log('Nenhum indicador de login encontrado');
    return false;
  } catch (error) {
    console.error('Erro ao verificar status de login:', error);
    return false;
  }
}

module.exports = {
  performTikTokActions
}; 
FROM mcr.microsoft.com/playwright:v1.40.0-focal

WORKDIR /app

# Copiar arquivos do projeto
COPY package*.json ./
COPY src ./src

# Instalar dependências e atualizar o Playwright
RUN npm ci
RUN npx playwright install chromium

# Expor porta da aplicação
EXPOSE 3000

# Comando para iniciar a aplicação
CMD ["node", "src/index.js"] 
FROM mcr.microsoft.com/playwright:v1.52.0-focal

WORKDIR /app

# Copiar arquivos do projeto
COPY package*.json ./
COPY src ./src

# Instalar dependências
RUN npm ci

# Expor porta da aplicação
EXPOSE 3000

# Comando para iniciar a aplicação
CMD ["node", "src/index.js"] 
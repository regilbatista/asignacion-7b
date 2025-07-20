FROM node:18-alpine

# Instalar dependencias del sistema
RUN apk add --no-cache \
    make \
    g++ \
    postgresql-client \
    openssh-client \
    curl \
    tzdata

# Crear directorio de trabajo
WORKDIR /app

# Copiar package files
COPY package*.json ./
RUN npm install --production

# Copiar código fuente
COPY unipago_importer.js ./
COPY unipago_audit.js ./
COPY unipago_config.ini ./

# Crear directorios necesarios
RUN mkdir -p /app/logs /app/temp /app/keys

# Configurar usuario no-root
RUN addgroup -g 1002 -S unipago && \
    adduser -u 1002 -S unipago -G unipago

# Cambiar permisos
RUN chown -R unipago:unipago /app
USER unipago

# Configurar timezone
ENV TZ=America/Santo_Domingo

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('Unipago Importer is running')" || exit 1

# Comando por defecto
CMD ["node", "unipago_importer.js", "--monitor"]

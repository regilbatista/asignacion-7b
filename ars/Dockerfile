FROM node:18-alpine

# Instalar dependencias del sistema
RUN apk add --no-cache \
    make \
    g++ \
    mysql-client \
    openssh-client \
    curl \
    tzdata

# Crear directorio de trabajo
WORKDIR /app

# Copiar package files
COPY package*.json ./
RUN npm install --production

# Copiar código fuente
COPY ars_exporter.js ./
COPY ars_audit.js ./
COPY ars_config.ini ./

# Crear directorios necesarios
RUN mkdir -p /app/logs /app/temp /app/backups

# Configurar usuario no-root
RUN addgroup -g 1001 -S ars && \
    adduser -u 1001 -S ars -G ars

# Cambiar permisos
RUN chown -R ars:ars /app
USER ars

# Configurar timezone
ENV TZ=America/Santo_Domingo

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('ARS Exporter is running')" || exit 1

# Comando por defecto
CMD ["node", "ars_exporter.js", "--schedule"]

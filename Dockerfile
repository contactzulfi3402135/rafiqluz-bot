FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=20249
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
RUN mkdir -p /app/data /app/sessions /app/media /app/logs /app/backups && chown -R node:node /app
USER node
EXPOSE 20249
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--max-old-space-size=320", "src/index.js"]

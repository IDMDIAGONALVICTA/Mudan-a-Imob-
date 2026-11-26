FROM node:20-alpine
WORKDIR /app
COPY . .
RUN mkdir /dados && chown node:node /dados
ENV NODE_ENV=production DATA_DIR=/dados PORT=3000
VOLUME ["/dados"]
EXPOSE 3000
USER node
CMD ["node", "server.js"]

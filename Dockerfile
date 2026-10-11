FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=3010

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .

USER node
EXPOSE 3010

CMD ["npm", "start"]
